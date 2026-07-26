"""
Reads a Common Paper standard-terms template into a clause tree.

The templates in `templates/` are not free-form markdown. Every line is blank,
the `# Title`, or a list item at one of four indents, and every fillable value
is already marked up::

    1. <span class="header_2" id="1">Pilot Access</span>
        1. <span class="header_3" id="1.1">Access and Use.</span>  During the
           <span class="orderform_link">Pilot Period</span> and subject to ...

That regularity is the whole reason this feature is a parser rather than ten
hand-transcriptions. The variable spans mean a document's field list is
*discovered* from the contract text instead of being typed out beside it, so a
field can never quietly go missing from the form while the clause that needs it
stays in the agreement.

The Mutual NDA is deliberately not parsed here. It arrived with a fill-in cover
page and a verbatim transcription in `frontend/lib/nda/standard-terms.ts` whose
own test diffs it against `templates/mutual-nda.md`; it keeps both.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# The classes Common Paper uses to link a value back to whichever fill-in page
# the document has. Which one a template uses is a fact about that document's
# paperwork — an Order Form, Key Terms, a Cover Page — and not about the value,
# so they are all read the same way.
VARIABLE_CLASSES = (
    "coverpage_link",
    "orderform_link",
    "keyterms_link",
    "businessterms_link",
    "sow_link",
)

# One list item. The marker is decimal at the top two levels, `a.` below that,
# and roman deeper still; the indent is what actually says how deep it sits.
ITEM = re.compile(r"^(?P<indent> *)(?P<marker>[0-9]+|[a-z]+)\.[ \t]+(?P<rest>.*)$")

INDENT_WIDTH = 4

# A leading `<span class="header_2" id="1.1">Heading.</span>`, or the plain
# `<span id="3.1">…</span>` anchor that opens a subsection with no heading.
#
# Only the classed form is a heading. The bare anchor is sometimes empty, but it
# just as often wraps the first word or two of the sentence — `<span
# id="11.1">Except</span>`, `<span id="5.6.a">The</span>` — so treating its
# contents as a heading would delete those words from the agreement. Whatever is
# inside a bare anchor is body text.
LEAD_SPAN = re.compile(
    r'^<span(?: class="(?P<cls>header_[23])")?(?: id="[^"]*")?>(?P<inner>.*?)</span>'
)

# The Cloud Service Agreement closes one definition twice
# (`…**"Variable"**</span></span> means…`). Left in, the stray tag prints as
# literal text inside a contract, so any tag that survives parsing is dropped.
STRAY_TAG = re.compile(r"</?span[^>]*>")

VARIABLE_SPAN = re.compile(
    r'<span class="(?:' + "|".join(VARIABLE_CLASSES) + r')">(?P<name>.*?)</span>'
)

# Bold and variables interleave, so they are read in one pass. Bold cannot be
# matched as a pair: the templates put whole liability caps in bold *around* the
# value — `**…will not be more than the <span …>General Cap Amount</span>.**` —
# and a paired match would find nothing there and drop the emphasis. Since these
# are conspicuous-disclaimer clauses, that emphasis is the legally operative
# part of the formatting, so `**` is read as a toggle instead.
TOKEN = re.compile(
    r"(?P<bold>\*\*)"
    r'|<span class="(?:' + "|".join(VARIABLE_CLASSES) + r')">(?P<name>.*?)</span>'
)

# `[text](url)` and `<url>`. Both are rendered as their visible text, which in
# these templates is the URL itself — nothing is lost on the page.
MD_LINK = re.compile(r"\[(?P<text>[^\]]*)\]\((?P<url>[^)]*)\)")
AUTOLINK = re.compile(r"<(?P<url>https?://[^>]+)>")

APOSTROPHES = "'’"


@dataclass(frozen=True)
class Segment:
    """A run of clause text, or a reference to a fill-in value."""

    kind: str  # "text" | "variable"
    text: str
    # Set only on "variable": the canonical key the value is stored under. The
    # `text` alongside it stays exactly as the template wrote it, so "Customer's"
    # and "Subscription Periods" keep their grammar on the page.
    key: str | None = None
    strong: bool = False

    def as_json(self) -> dict[str, object]:
        payload: dict[str, object] = {"kind": self.kind, "text": self.text}
        if self.kind == "variable":
            payload["key"] = self.key or ""
        if self.strong:
            payload["strong"] = True
        return payload


@dataclass
class Clause:
    """One item of the agreement, numbered the way the document numbers it."""

    number: str  # "1", "1.1", "1.1.a"
    depth: int
    heading: str | None
    segments: list[Segment] = field(default_factory=list)

    def as_json(self) -> dict[str, object]:
        return {
            "number": self.number,
            "depth": self.depth,
            "heading": self.heading,
            "segments": [segment.as_json() for segment in self.segments],
        }


@dataclass
class ParsedTemplate:
    title: str
    clauses: list[Clause]
    # Canonical variable name -> the clause numbers that cite it, in order. The
    # frontend marks those clauses when a value changes, the same way the NDA
    # workspace always has — except here the mapping is observed, not written.
    variables: dict[str, list[str]]


def strip_possessive(name: str) -> str:
    """`Customer's` and `Customer’s` are both the Customer."""
    for apostrophe in APOSTROPHES:
        suffix = f"{apostrophe}s"
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def canonical_key(name: str) -> str:
    """
    A camelCase identifier for a variable name.

    Used as the field name in the model's structured output and as the key the
    browser stores the value under, so it has to be a plain identifier:
    "Pilot Period" -> pilotPeriod, "SOW Term" -> sowTerm, "DPA" -> dpa.
    """
    words = [word for word in re.split(r"[^A-Za-z0-9]+", name) if word]
    if not words:
        raise ValueError(f"Variable name has no usable characters: {name!r}")

    head, *rest = words
    return head.lower() + "".join(word[:1].upper() + word[1:].lower() for word in rest)


def _fold_plurals(names: set[str]) -> dict[str, str]:
    """
    Maps each raw name to the one the document actually defines.

    These templates cite a defined term in whatever number the sentence needs —
    "Subscription Period" in one clause and "Subscription Periods" in the next,
    "Deliverable" and "Deliverables", "Customer Covered Claim" and its plural.
    They are one value on one form, so a plural folds into the singular *when
    the singular is also present*. "Approved Subprocessors" and "Increased
    Claims" have no singular anywhere and stay exactly as written.
    """
    resolved: dict[str, str] = {}
    for name in names:
        singular = name[:-1] if name.endswith("s") else name
        resolved[name] = singular if singular != name and singular in names else name
    return resolved


def _inline(text: str) -> str:
    """Reduces the markdown link forms to the text a printed page would show."""
    text = MD_LINK.sub(lambda match: match.group("text"), text)
    text = AUTOLINK.sub(lambda match: match.group("url"), text)
    # Variable spans are consumed before this runs, so anything still tag-shaped
    # here is malformed source rather than markup we mean to keep.
    return STRAY_TAG.sub("", text)


def _segments(body: str, resolve: dict[str, str]) -> list[Segment]:
    """
    Splits one clause body into text and variable runs, carrying bold across both.

    Variable names are matched against the template's own wording; the emphasis
    state is whatever the surrounding `**` toggles have left it as.
    """
    segments: list[Segment] = []
    strong = False
    position = 0

    def push_text(raw: str) -> None:
        cleaned = _inline(raw)
        if cleaned:
            segments.append(Segment("text", cleaned, strong=strong))

    for match in TOKEN.finditer(body):
        push_text(body[position : match.start()])
        position = match.end()

        if match.group("bold"):
            strong = not strong
            continue

        written = match.group("name")
        canonical = resolve[strip_possessive(written)]
        segments.append(
            Segment("variable", written, key=canonical_key(canonical), strong=strong)
        )

    push_text(body[position:])
    return segments


def parse_template(path: Path) -> ParsedTemplate:
    """Reads one standard-terms template into clauses and the variables they cite."""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")

    # Two passes: the plural folding in pass two needs to know every name the
    # document uses, including ones that only appear after the clause in hand.
    written_names = {
        strip_possessive(match.group("name"))
        for match in VARIABLE_SPAN.finditer(text)
    }
    resolve = _fold_plurals(written_names)

    title = ""
    clauses: list[Clause] = []
    variables: dict[str, list[str]] = {}
    markers: list[str] = []

    for raw_line in lines:
        line = raw_line.rstrip("\r")
        if not line.strip():
            continue

        if line.startswith("# ") and not title:
            title = line[2:].strip()
            continue

        item = ITEM.match(line)
        if not item:
            raise ValueError(f"{path.name}: line is not a list item: {line[:80]!r}")

        indent = len(item.group("indent"))
        if indent % INDENT_WIDTH:
            raise ValueError(f"{path.name}: ragged indent on {line[:60]!r}")
        depth = indent // INDENT_WIDTH

        # The number is the path of markers down to here — "1", then "1.1",
        # then "1.1.a" — which is what the templates' own `id` attributes say
        # wherever they bother to carry one.
        del markers[depth:]
        markers.append(item.group("marker"))
        number = ".".join(markers)

        rest = item.group("rest").strip()
        heading: str | None = None
        lead = LEAD_SPAN.match(rest)
        if lead:
            inner = lead.group("inner").strip()
            remainder = rest[lead.end() :]
            if lead.group("cls"):
                # A heading reads "Access and Use." in the source; the renderer
                # supplies its own punctuation, as the NDA's clause list does.
                heading = inner.rstrip(".") or None
                rest = remainder.strip()
            else:
                # A bare anchor: its contents are the opening of the sentence.
                rest = f"{inner}{remainder}".strip()

        clause = Clause(number=number, depth=depth, heading=heading)
        clause.segments = _segments(rest, resolve)
        clauses.append(clause)

        for segment in clause.segments:
            if segment.kind != "variable" or segment.key is None:
                continue
            seen = variables.setdefault(segment.key, [])
            if number not in seen:
                seen.append(number)

    if not title:
        raise ValueError(f"{path.name}: no `# Title` line")

    return ParsedTemplate(title=title, clauses=clauses, variables=variables)


def variable_names(path: Path) -> dict[str, str]:
    """
    Every variable the template cites: canonical key -> name as the source
    writes it (singular, without a possessive).

    This is what a definition file has to account for, exactly.
    """
    text = path.read_text(encoding="utf-8")
    written = {
        strip_possessive(match.group("name"))
        for match in VARIABLE_SPAN.finditer(text)
    }
    resolve = _fold_plurals(written)
    return {canonical_key(name): name for name in set(resolve.values())}
