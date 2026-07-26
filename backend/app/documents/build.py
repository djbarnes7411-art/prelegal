"""
Compiles the templates and their definitions into what both halves read.

    definitions/*.toml  +  templates/*.md
                    |
                    v
    frontend/lib/documents/generated/
        catalog.json          every document's fields and blurb   (both halves)
        clauses/<slug>.json   one document's contract text        (browser only)
        clauses.ts            a loader per clause file            (browser only)

Run with `uv run python -m app.documents.build` from `backend/`; `--check`
verifies the committed output matches a fresh compile without writing, which is
what the test suite calls.

**The split is not premature tidying.** Clause text is 90% of the bytes here and
the backend never reads a word of it — it needs field definitions to build a
prompt and check an answer, nothing more. Keeping it in a separate file per
document means the browser fetches one agreement's text instead of eleven, and
the backend cannot grow a dependency on contract prose by accident.

`clauses.ts` exists because a bundler cannot follow a dynamic import whose path
is only known at runtime, to a set of files it has to discover at build time.
Generating an explicit loader per slug keeps the import statically analysable,
and generating it means it can never drift from the files beside it.

The output is committed rather than built on demand for two reasons: the
frontend is a static export with no Node at runtime, so it needs the data at
build time; and a change to contract text then shows up as a reviewable diff in
the pull request that causes it, rather than appearing on someone's next deploy.

It lives under `frontend/` because Turbopack will not resolve an import from
outside its project root, and because the Dockerfile's `COPY frontend/ ./`
carries it into the image with no extra step. The backend reads `catalog.json`
from that same path.
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path
from typing import Any

from pydantic.alias_generators import to_camel

from .parse import canonical_key, parse_template, variable_names

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFINITIONS_DIR = REPO_ROOT / "definitions"
GENERATED_DIR = REPO_ROOT / "frontend" / "lib" / "documents" / "generated"
CATALOG_PATH = GENERATED_DIR / "catalog.json"
CLAUSES_DIR = GENERATED_DIR / "clauses"
LOADERS_PATH = GENERATED_DIR / "clauses.ts"

# What a field can be. Each one is a promise about the value that the chat
# engine enforces and the renderer relies on, so the list is deliberately short:
# a type earns its place by changing how a value is checked or printed.
#
#   party     a company and who signs for it
#   date      an ISO calendar date
#   money     an amount with a currency, kept as the user's own words
#   text      one line
#   longText  a paragraph
#   term      a length in years or an open-ended alternative (Mutual NDA only)
FIELD_TYPES = {"party", "date", "money", "text", "longText", "term"}


class DefinitionError(Exception):
    """A definition and its template disagree. Always fatal — never a warning."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DefinitionError(message)


def _load_definition(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _build_field(
    key: str,
    spec: dict[str, Any],
    name: str,
    clauses: list[str],
    where: str,
) -> dict[str, Any]:
    kind = spec.get("type")
    _require(kind in FIELD_TYPES, f"{where}: field {key!r} has unknown type {kind!r}")

    # The key becomes an attribute on a generated Pydantic model and a property
    # name in the browser's state, and the model's structured output is read
    # back by camelCase alias. All three only line up if the key is already a
    # camelCase identifier, so a template variable that would not produce one
    # (a name starting with a digit, say) has to be caught here rather than as a
    # confusing failure at the first chat turn.
    _require(
        key.isidentifier(), f"{where}: field key {key!r} is not a valid identifier"
    )
    _require(
        to_camel(key) == key,
        f"{where}: field key {key!r} is not stable under camelCase aliasing "
        f"(becomes {to_camel(key)!r})",
    )

    field: dict[str, Any] = {
        "key": key,
        "name": name,
        "type": kind,
        # How the assistant refers to the field when it asks. Without one it
        # would have to read the defined term aloud ("what is the General Cap
        # Amount?"), which is the document's language, not a person's.
        "label": spec.get("label") or name,
        "required": bool(spec.get("required", False)),
        "clauses": clauses,
    }
    if spec.get("hint"):
        field["hint"] = spec["hint"]

    if kind == "term":
        for option in ("counted", "openEnded"):
            _require(
                isinstance(spec.get(option), str),
                f"{where}: term field {key!r} needs a {option!r} name",
            )
        field["counted"] = spec["counted"]
        field["openEnded"] = spec["openEnded"]
        field["noun"] = spec.get("noun", "year")

    # A starting value, so the document beside the conversation is not blank on
    # arrival. The assistant is told which fields these are and asked not to
    # raise them, since a default the user never mentioned is not a question.
    # `"today"` is resolved in the browser: the effective date has to come from
    # the reader's own clock, not the server's.
    if "default" in spec:
        _require(
            kind in {"text", "longText", "money", "date"},
            f"{where}: field {key!r} of type {kind!r} cannot take a 'default'",
        )
        _require(
            isinstance(spec["default"], str) and spec["default"].strip(),
            f"{where}: field {key!r} has an empty default",
        )
        _require(
            kind != "date" or spec["default"] == "today",
            f"{where}: a date default must be \"today\", not {spec['default']!r}",
        )
        field["default"] = spec["default"]

    if "defaultYears" in spec:
        _require(
            kind == "term",
            f"{where}: field {key!r} of type {kind!r} cannot take 'defaultYears'",
        )
        _require(
            isinstance(spec["defaultYears"], int)
            and not isinstance(spec["defaultYears"], bool)
            and spec["defaultYears"] >= 1,
            f"{where}: field {key!r} has a defaultYears that is not a whole count",
        )
        field["defaultYears"] = spec["defaultYears"]

    return field


def compile_document(path: Path) -> dict[str, Any]:
    """Reads one definition, checks it against its template, and returns the entry."""
    definition = _load_definition(path)
    where = path.name

    for required_key in ("slug", "name", "summary"):
        _require(
            isinstance(definition.get(required_key), str) and definition[required_key],
            f"{where}: missing {required_key!r}",
        )

    specs = definition.get("fields")
    _require(isinstance(specs, dict) and bool(specs), f"{where}: no [fields] table")

    template = definition.get("template")
    clauses: list[dict[str, Any]] = []
    title = definition["name"]
    cited: dict[str, list[str]] = {}
    names: dict[str, str] = {}

    if template:
        template_path = REPO_ROOT / template
        _require(template_path.is_file(), f"{where}: no template at {template}")

        parsed = parse_template(template_path)
        clauses = [clause.as_json() for clause in parsed.clauses]
        title = parsed.title
        cited = parsed.variables
        names = variable_names(template_path)

        # The check the whole arrangement rests on. A template that gains a
        # variable must gain a definition for it in the same commit, and a
        # definition may not describe a value the contract never asks for —
        # either way the build stops rather than shipping a document with a
        # blank nobody can fill or a question nobody needs to answer.
        declared, found = set(specs), set(names)
        missing = sorted(found - declared)
        unknown = sorted(declared - found)
        _require(
            not missing,
            f"{where}: template uses undefined variables: {missing}. "
            "Add them to [fields] or they can never be filled in.",
        )
        _require(
            not unknown,
            f"{where}: [fields] describes variables the template never cites: "
            f"{unknown}. Remove them or fix the spelling.",
        )
    else:
        # Only the Mutual NDA takes this path: it arrived with its own fill-in
        # cover page and a verbatim transcription in the frontend, so its clause
        # text and field list are not derived from a parsed template. The
        # transcription has its own fidelity test against templates/mutual-nda.md.
        _require(
            definition.get("renderer") == "mutual-nda",
            f"{where}: a definition with no template needs renderer = 'mutual-nda'",
        )

    fields = []
    for key, spec in specs.items():
        _require(
            isinstance(spec, dict), f"{where}: field {key!r} is not a table"
        )
        name = names.get(key) or spec.get("variable") or key
        _require(
            not template or canonical_key(name) == key,
            f"{where}: field {key!r} does not match variable {name!r}",
        )
        fields.append(_build_field(key, spec, name, cited.get(key, []), where))

    _require(
        any(field["required"] for field in fields),
        f"{where}: no required fields, so the document is never finishable",
    )

    return {
        "slug": definition["slug"],
        "name": definition["name"],
        "title": title,
        "summary": definition["summary"],
        # Free text the concierge matches a request against, alongside the name
        # and summary. Plain words people actually use, not legal ones.
        "aliases": list(definition.get("aliases", [])),
        # Set where the document is not a standalone agreement. Both the chat
        # and the page say so; it is a fact about the template, not a defect.
        "attachment": definition.get("attachment"),
        "renderer": definition.get("renderer", "generic"),
        "version": definition.get("version"),
        "sourceUrl": definition.get("sourceUrl"),
        "fields": fields,
        "clauses": clauses,
    }


NOTE = "Generated file. Edit definitions/*.toml or templates/*.md instead."


def _json(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def _loaders_module(slugs: list[str]) -> str:
    """The generated TypeScript that lets a bundler see every clause file."""
    imports = "\n".join(
        f'  "{slug}": () => import("./clauses/{slug}.json"),' for slug in slugs
    )
    return f"""/* {NOTE} */

/**
 * One dynamic import per document, so the browser downloads the agreement it is
 * drafting and not the other ten. Written out rather than built from the slug
 * because a bundler cannot follow an import path it only learns at runtime.
 *
 * Typed as `unknown` on purpose: TypeScript infers a JSON module's string
 * fields as `string`, not as the literal unions `ClauseFile` declares, so the
 * narrowing happens once in `loadClauses` rather than eleven times here.
 */
export const CLAUSE_LOADERS: Record<string, () => Promise<{{ default: unknown }}>> = {{
{imports}
}};
"""


def compile_all() -> tuple[dict[str, Any], dict[str, Any], str]:
    """Returns the catalog, the clause file for each slug, and the loader module."""
    paths = sorted(DEFINITIONS_DIR.glob("*.toml"))
    if not paths:
        raise DefinitionError(f"No definitions found in {DEFINITIONS_DIR}")

    documents = [compile_document(path) for path in paths]

    slugs = [document["slug"] for document in documents]
    duplicates = {slug for slug in slugs if slugs.count(slug) > 1}
    _require(not duplicates, f"Duplicate slugs: {sorted(duplicates)}")

    clause_files = {
        document["slug"]: {"slug": document["slug"], "clauses": document["clauses"]}
        for document in documents
        if document["clauses"]
    }
    catalog = {
        "generator": "backend/app/documents/build.py",
        "note": NOTE,
        "documents": [
            {key: value for key, value in document.items() if key != "clauses"}
            for document in documents
        ],
    }
    return catalog, clause_files, _loaders_module(sorted(clause_files))


def _written_files(
    catalog: dict[str, Any], clause_files: dict[str, Any], loaders: str
) -> dict[Path, str]:
    files = {CATALOG_PATH: _json(catalog), LOADERS_PATH: loaders}
    for slug, payload in clause_files.items():
        files[CLAUSES_DIR / f"{slug}.json"] = _json(payload)
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the committed output is current; write nothing.",
    )
    args = parser.parse_args(argv)

    try:
        files = _written_files(*compile_all())
    except DefinitionError as failure:
        print(f"documents: {failure}", file=sys.stderr)
        return 2

    # A clause file for a document that no longer exists would keep being served
    # by the loader module until someone noticed, so stale files are an error in
    # their own right rather than something the next write happens to overwrite.
    stale = sorted(
        path for path in CLAUSES_DIR.glob("*.json") if path not in files
    ) if CLAUSES_DIR.is_dir() else []

    if args.check:
        outdated = [
            path
            for path, text in files.items()
            if not path.is_file() or path.read_text(encoding="utf-8") != text
        ]
        if outdated or stale:
            for path in sorted(outdated) + stale:
                print(
                    f"documents: {path.relative_to(REPO_ROOT)} is out of date",
                    file=sys.stderr,
                )
            print(
                "documents: run `uv run python -m app.documents.build`",
                file=sys.stderr,
            )
            return 1
        print(f"documents: {len(files)} generated files are current")
        return 0

    CLAUSES_DIR.mkdir(parents=True, exist_ok=True)
    for path, text in files.items():
        # `newline=""` writes the "\n" we rendered rather than translating it to
        # the platform's line ending, so a committed artifact is byte-identical
        # whether it was generated on Windows, macOS or Linux. (`--check` reads
        # with universal newlines and so would pass either way; this keeps the
        # diff from changing depending on who ran the build.)
        with path.open("w", encoding="utf-8", newline="") as handle:
            handle.write(text)
    for path in stale:
        path.unlink()

    total = sum(len(text) for text in files.values()) // 1024
    print(
        f"documents: wrote {len(files)} files to "
        f"{GENERATED_DIR.relative_to(REPO_ROOT)} ({total} KiB), "
        f"catalog {len(files[CATALOG_PATH]) // 1024} KiB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
