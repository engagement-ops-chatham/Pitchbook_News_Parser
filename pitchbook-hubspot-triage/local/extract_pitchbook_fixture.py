import argparse
import json
import re
from pathlib import Path

from extract_msg import Message


ITEM_SPLIT_RE = re.compile(
    r"\n\s*(?P<source>[^\n|]+)\s*\|\s*(?P<time>[^\n|]+)\s*\|\s*(?P<date>\d{1,2}-[A-Za-z]{3}-\d{4})\s*\n"
)


def _clean_text(text: str) -> str:
    return text.replace("\r", "").replace("\u200a", "").replace("\u200d", "").strip()


def extract_fixture(msg_path: Path) -> dict:
    message = Message(str(msg_path))
    body = _clean_text(message.body or "")
    segments = ITEM_SPLIT_RE.split(body)
    items = []

    if len(segments) >= 4:
        for index in range(1, len(segments), 4):
            if index + 3 >= len(segments):
                break

            source_name = _clean_text(segments[index])
            published_time = _clean_text(segments[index + 1])
            published_date = _clean_text(segments[index + 2])
            chunk = _clean_text(segments[index + 3])
            lines = [line.strip() for line in chunk.splitlines() if line.strip()]
            headline = lines[0] if lines else ""

            items.append(
                {
                    "item_type": "news",
                    "headline": headline,
                    "source_name": source_name,
                    "published_at": f"{published_date} {published_time}".strip(),
                    "raw_excerpt": "\n".join(lines[:6]),
                }
            )

    if not items:
        raise ValueError(f"No PitchBook items found in message: {msg_path}")

    return {
        "source_subject": message.subject,
        "source_sender": message.sender,
        "source_date": str(message.date),
        "items": items,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("msg_path")
    parser.add_argument("output_path")
    args = parser.parse_args()

    fixture = extract_fixture(Path(args.msg_path))
    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
