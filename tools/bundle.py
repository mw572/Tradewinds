#!/usr/bin/env python3
"""Bundle Tradewinds into one self-contained HTML file.

Why not a real bundler: the game deliberately has no build step, so there is no
node_modules and no rollup. This does the one job needed — turn N ES modules
plus a vendored Three.js into a single <script> with no imports — in a way that
is auditable in one screen.

Each module becomes an IIFE that returns its exports as an object. Imports are
rewritten to destructure from the module objects built before it. That keeps
every module's internals in its own scope, so a helper called `clamp` in three
different files cannot collide.

Usage:  python3 tools/bundle.py  ->  dist/tradewinds.html
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Dependency order. Anything importing a module must come after it.
MODULES = [
    "world.js",
    "coastline.js",
    "economy.js",
    "ocean.js",
    "sky.js",
    "ship3d.js",
    "harbour.js",
    "sailing.js",
    "chart.js",
    "game.js",
]

IMPORT_RE = re.compile(
    r'^\s*import\s+(?:(?P<ns>\*\s+as\s+\w+)|(?P<named>\{[^}]*\})|(?P<def>\w+))\s+from\s+["\'](?P<src>[^"\']+)["\']\s*;?\s*$',
    re.M,
)
BARE_IMPORT_RE = re.compile(r'^\s*import\s+["\'][^"\']+["\']\s*;?\s*$', re.M)
EXPORT_LIST_RE = re.compile(r'^\s*export\s*\{(?P<names>[^}]*)\}\s*;?\s*$', re.M)
EXPORT_DECL_RE = re.compile(r'^(\s*)export\s+(?=(?:const|let|var|function|class|async)\b)', re.M)
NAMED_DECL_RE = re.compile(
    r'^\s*export\s+(?:const|let|var|function|class|async\s+function)\s+(?P<name>[A-Za-z_$][\w$]*)', re.M
)


def module_key(path):
    return os.path.basename(path).replace(".js", "").replace("-", "_")


def collect_exports(src):
    """Every name this module exports, from both declaration and list forms."""
    names = []
    for m in NAMED_DECL_RE.finditer(src):
        names.append(m.group("name"))
    for m in EXPORT_LIST_RE.finditer(src):
        for raw in m.group("names").split(","):
            raw = raw.strip()
            if not raw:
                continue
            # `a as b` exports under b
            names.append(raw.split(" as ")[-1].strip())
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def rewrite(src, self_name):
    """Strip imports/exports, returning (body, prelude_lines, export_names)."""
    prelude = []

    def take_import(m):
        target = m.group("src")
        if target == "three":
            # Not "THREE": sailing.js does `import * as THREE from "three"`,
            # which would emit `const THREE = THREE;` and die in the TDZ.
            key = "__three_ns"
        else:
            key = "__" + module_key(target)
        if m.group("ns"):
            alias = m.group("ns").split("as")[-1].strip()
            prelude.append(f"const {alias} = {key};")
        elif m.group("named"):
            inner = m.group("named").strip()[1:-1]
            parts = [p.strip() for p in inner.split(",") if p.strip()]
            fixed = []
            for p in parts:
                if " as " in p:
                    a, b = [x.strip() for x in p.split(" as ")]
                    fixed.append(f"{a}: {b}")
                else:
                    fixed.append(p)
            prelude.append("const { " + ", ".join(fixed) + " } = " + key + ";")
        elif m.group("def"):
            prelude.append(f"const {m.group('def')} = {key}.default;")
        return ""

    body = IMPORT_RE.sub(take_import, src)
    body = BARE_IMPORT_RE.sub("", body)
    exports = collect_exports(src)
    body = EXPORT_LIST_RE.sub("", body)
    body = EXPORT_DECL_RE.sub(r"\1", body)
    return body, prelude, exports


def wrap_three(src):
    """Three.js ships as ESM ending in one big `export { ... };`."""
    m = EXPORT_LIST_RE.search(src)
    if not m:
        sys.exit("bundle: could not find Three.js export list")
    names = [n.strip() for n in m.group("names").split(",") if n.strip()]
    pairs = []
    for n in names:
        if " as " in n:
            a, b = [x.strip() for x in n.split(" as ")]
            pairs.append(f"{b}: {a}")
        else:
            pairs.append(n)
    body = EXPORT_LIST_RE.sub("", src)
    return (
        "const __three_ns = (function(){\n"
        + body
        + "\nreturn { " + ", ".join(pairs) + " };\n})();\n"
    ), len(names)


def main():
    src_dir = os.path.join(ROOT, "src")
    out_dir = os.path.join(ROOT, "dist")
    os.makedirs(out_dir, exist_ok=True)

    three_src = open(os.path.join(ROOT, "vendor", "three.module.js")).read()
    three_block, n_exports = wrap_three(three_src)

    blocks = [three_block]
    for name in MODULES:
        raw = open(os.path.join(src_dir, name)).read()
        body, prelude, exports = rewrite(raw, name)
        key = "__" + module_key(name)
        ret = "return { " + ", ".join(exports) + " };" if exports else "return {};"
        blocks.append(
            f"/* ===== {name} ===== */\nconst {key} = (function(){{\n"
            + "\n".join(prelude)
            + "\n"
            + body
            + "\n"
            + ret
            + "\n})();\n"
        )

    css = open(os.path.join(ROOT, "styles.css")).read()
    html = open(os.path.join(ROOT, "index.html")).read()

    # Take the markup between <div id="app"> and its closing tag, inclusive.
    start = html.index('<div id="app">')
    end = html.rindex("</div>") + len("</div>")
    app = html[start:end]

    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no"/>
<title>Tradewinds</title>
<meta name="description" content="An Age-of-Sail trading game. Read the market, plot a course, and bring her alongside by hand."/>
<meta name="theme-color" content="#0b1a24"/>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>%E2%9A%93</text></svg>"/>
<style>
{css}
</style>
</head>
<body>
{app}
<script>
{"".join(blocks)}
</script>
</body>
</html>
"""
    out = os.path.join(out_dir, "tradewinds.html")
    open(out, "w").write(doc)
    print(f"bundled {len(MODULES)} modules + Three.js ({n_exports} exports)")
    print(f"{out}  {len(doc) / 1024:.0f} KB")

    # Fragment build. The Artifact host supplies its own doctype/head/body and
    # wraps whatever it is given, so a second full document would nest and be
    # invalid. Same content, shell removed.
    frag = f"""<title>Tradewinds</title>
<style>
html, body {{ margin: 0; padding: 0; height: 100%; overflow: hidden; }}
{css}
</style>
{app}
<script>
{"".join(blocks)}
</script>
"""
    fout = os.path.join(out_dir, "tradewinds-artifact.html")
    open(fout, "w").write(frag)
    print(f"{fout}  {len(frag) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
