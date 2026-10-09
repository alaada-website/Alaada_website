"""Package the browser client from the monolith without importing the server."""
import argparse
import ast
from pathlib import Path


def render(source, endpoint, project):
    tree = ast.parse(source.read_text(encoding="utf-8"))
    value = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == "PRODUCT_CLIENT"
                         for target in node.targets))
    return ast.literal_eval(value).replace("__ENDPOINT__", endpoint).replace("__PROJECT__", project)


def mirror_literal(source, target):
    """Synchronise only the generated client literal; preserve other source edits."""
    def client_node(text):
        return next(node.value for node in ast.parse(text).body if isinstance(node, ast.Assign)
                    and any(isinstance(name, ast.Name) and name.id == "PRODUCT_CLIENT" for name in node.targets))
    canonical = source.read_text(encoding="utf-8")
    existing = target.read_text(encoding="utf-8")
    old = client_node(existing)
    lines = existing.splitlines(keepends=True)
    start = sum(map(len, lines[:old.lineno - 1])) + old.col_offset
    end = sum(map(len, lines[:old.end_lineno - 1])) + old.end_col_offset
    updated = existing[:start] + ast.get_source_segment(canonical, client_node(canonical)) + existing[end:]
    ast.parse(updated)
    target.write_text(updated, encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1] / "alaada_workspaces.py")
    parser.add_argument("--endpoint", default="https://sfo.cloud.appwrite.io/v1")
    parser.add_argument("--project", default="6972444700208a437da1")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--test-output", type=Path)
    parser.add_argument("--mirror-source", type=Path)
    args = parser.parse_args()
    client = render(args.source, args.endpoint, args.project)
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != client:
            parser.exit(1, "Published workspace client differs from the monolith.\n")
        print("Published workspace client matches the monolith.")
    else:
        args.output.write_text(client, encoding="utf-8", newline="\n")
        print("Packaged workspace client from the monolith.")
        if args.mirror_source:
            mirror_literal(args.source, args.mirror_source)
    if args.test_output:
        tests = (args.source.parent / "tests" / "test_workspace_product_client.cjs").read_text(encoding="utf-8")
        if args.check:
            if not args.test_output.is_file() or args.test_output.read_text(encoding="utf-8") != tests:
                parser.exit(1, "Published transport tests differ from canonical tests.\n")
        else:
            args.test_output.write_text(tests, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
