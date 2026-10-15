"""Inline styles.css, game-logic.js and app.js into one self-contained HTML file.
Usage:  python3 reference/build-single-file.py
Output: reference/number-match.html
"""
import pathlib

here = pathlib.Path(__file__).parent
src = here / "src"
html = (src / "index.html").read_text()
css = (src / "styles.css").read_text()
logic = (src / "game-logic.js").read_text()
app = (src / "app.js").read_text()

html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<script src="game-logic.js"></script>', "<script>\n" + logic + "\n</script>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + app + "\n</script>")
assert "styles.css" not in html and 'src="app.js"' not in html
(here / "number-match.html").write_text(html)
print("wrote", here / "number-match.html", len(html), "bytes")
