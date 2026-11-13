"""Builds the bundled OFL fonts in src/renderer/public/fonts from their original distributions.

Developer tool only (not shipped). Needs: python3 -m venv .venv && .venv/bin/pip install fonttools brotli
Run:  .venv/bin/python scripts/prepare-fonts.py <download-dir>

Policy (docs/text-overlay.md):
- Every font is SIL OFL 1.1; its OFL.txt is copied next to the font files.
- A font whose Reserved Font Name is its own family name (Nanum*, Pretendard, SUIT) is shipped
  byte-for-byte as distributed: subsetting or converting it would create a Modified Version that
  may not keep the reserved name.
- Other fonts are instanced to static weights, subset to Korean + Latin + common symbols and
  converted to WOFF2 to keep the installer small. Hanja and kana are dropped (canvas falls back
  to Pretendard, then the system font).
"""
import hashlib
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'renderer' / 'public' / 'fonts'
GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

# id: (license url, [(weight, source url, output name)], keep original bytes)
FONTS = {
    'pretendard': (
        'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/LICENSE.txt',
        [(400, 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-Regular.woff2', 'Pretendard-Regular.woff2'),
         (700, 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-Bold.woff2', 'Pretendard-Bold.woff2')], True),
    'suit': (
        'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2.0.5/LICENSE',
        [(400, 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2.0.5/fonts/static/woff2/SUIT-Regular.woff2', 'SUIT-Regular.woff2'),
         (700, 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2.0.5/fonts/static/woff2/SUIT-Bold.woff2', 'SUIT-Bold.woff2')], True),
    'nanumgothic': (f'{GF}/nanumgothic/OFL.txt', [(400, f'{GF}/nanumgothic/NanumGothic-Regular.ttf', 'NanumGothic-Regular.ttf'), (700, f'{GF}/nanumgothic/NanumGothic-Bold.ttf', 'NanumGothic-Bold.ttf')], True),
    'nanummyeongjo': (f'{GF}/nanummyeongjo/OFL.txt', [(400, f'{GF}/nanummyeongjo/NanumMyeongjo-Regular.ttf', 'NanumMyeongjo-Regular.ttf'), (700, f'{GF}/nanummyeongjo/NanumMyeongjo-Bold.ttf', 'NanumMyeongjo-Bold.ttf')], True),
    'nanumpen': (f'{GF}/nanumpenscript/OFL.txt', [(400, f'{GF}/nanumpenscript/NanumPenScript-Regular.ttf', 'NanumPenScript-Regular.ttf')], True),
    'nanumbrush': (f'{GF}/nanumbrushscript/OFL.txt', [(400, f'{GF}/nanumbrushscript/NanumBrushScript-Regular.ttf', 'NanumBrushScript-Regular.ttf')], True),
    'notosans': (f'{GF}/notosanskr/OFL.txt', [(400, f'{GF}/notosanskr/NotoSansKR[wght].ttf', 'NotoSansKR-Regular.woff2'), (700, f'{GF}/notosanskr/NotoSansKR[wght].ttf', 'NotoSansKR-Bold.woff2')], False),
    'notoserif': (f'{GF}/notoserifkr/OFL.txt', [(400, f'{GF}/notoserifkr/NotoSerifKR[wght].ttf', 'NotoSerifKR-Regular.woff2'), (700, f'{GF}/notoserifkr/NotoSerifKR[wght].ttf', 'NotoSerifKR-Bold.woff2')], False),
    'gowundodum': (f'{GF}/gowundodum/OFL.txt', [(400, f'{GF}/gowundodum/GowunDodum-Regular.ttf', 'GowunDodum-Regular.woff2')], False),
    'gowunbatang': (f'{GF}/gowunbatang/OFL.txt', [(400, f'{GF}/gowunbatang/GowunBatang-Regular.ttf', 'GowunBatang-Regular.woff2'), (700, f'{GF}/gowunbatang/GowunBatang-Bold.ttf', 'GowunBatang-Bold.woff2')], False),
    'blackhansans': (f'{GF}/blackhansans/OFL.txt', [(400, f'{GF}/blackhansans/BlackHanSans-Regular.ttf', 'BlackHanSans-Regular.woff2')], False),
    'dohyeon': (f'{GF}/dohyeon/OFL.txt', [(400, f'{GF}/dohyeon/DoHyeon-Regular.ttf', 'DoHyeon-Regular.woff2')], False),
    'jua': (f'{GF}/jua/OFL.txt', [(400, f'{GF}/jua/Jua-Regular.ttf', 'Jua-Regular.woff2')], False),
    'gaegu': (f'{GF}/gaegu/OFL.txt', [(400, f'{GF}/gaegu/Gaegu-Regular.ttf', 'Gaegu-Regular.woff2'), (700, f'{GF}/gaegu/Gaegu-Bold.ttf', 'Gaegu-Bold.woff2')], False),
    'dongle': (f'{GF}/dongle/OFL.txt', [(400, f'{GF}/dongle/Dongle-Regular.ttf', 'Dongle-Regular.woff2'), (700, f'{GF}/dongle/Dongle-Bold.ttf', 'Dongle-Bold.woff2')], False),
}

# Latin, punctuation, arrows, enclosed numbers, shapes, symbols (★♥♪), CJK punctuation, jamo, syllables, fullwidth.
UNICODES = '20-7E,A0-FF,2000-206F,20A9,2100-214F,2190-21FF,2460-24FF,25A0-25FF,2600-27BF,3000-303F,1100-11FF,3131-318F,AC00-D7A3,FF00-FFEF'


def fetch(url: str, cache: Path) -> Path:
    target = cache / hashlib.sha256(url.encode()).hexdigest()[:16] / urllib.parse.unquote(url.rsplit('/', 1)[1])
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url) as response:
            target.write_bytes(response.read())
    return target


def build(source: Path, weight: int, output: Path) -> None:
    font = TTFont(source)
    if 'fvar' in font:
        font = instancer.instantiateVariableFont(font, {'wght': weight}, updateFontNames=True)
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.notdef_outline = True
    options.flavor = 'woff2'
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    font.flavor = 'woff2'
    font.save(output)


def main() -> None:
    cache = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / '.font-cache')
    for font_id, (license_url, files, original) in FONTS.items():
        folder = OUT / font_id
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        license_text = fetch(license_url, cache).read_text(encoding='utf-8')
        if 'SIL Open Font License' not in license_text and 'SIL OPEN FONT LICENSE' not in license_text:
            raise SystemExit(f'{font_id}: license is not OFL')
        (folder / 'OFL.txt').write_text(license_text, encoding='utf-8')
        for weight, url, name in files:
            source = fetch(url, cache)
            if original:
                shutil.copyfile(source, folder / name)
            else:
                build(source, weight, folder / name)
            print(f'{font_id}/{name}: {(folder / name).stat().st_size // 1024} KiB')


if __name__ == '__main__':
    main()
