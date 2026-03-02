Drop sponsor logo files into this folder.

Supported formats:
- `.png`
- `.jpg` / `.jpeg`
- `.webp`
- `.svg`

The game auto-classifies each logo by aspect ratio:
- `flag` (roughly square / slightly landscape): ratio <= 1.12
- `billboard` (landscape): 1.12 < ratio < 2.15
- `banner` (very wide): ratio >= 2.15

Tips:
- Use transparent backgrounds (`.png` or `.webp`) for cleaner flags/billboards.
- Export images at 2x or 4x of your target display size for sharper results.
- If a file is broken or unsupported, it is skipped and the race still loads.
