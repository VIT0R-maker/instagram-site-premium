from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib

package = Path(__file__).resolve().parents[1]
workspace = package.parent
target = workspace / 'entrega_instagram_site_premium.zip'
excluded = {'node_modules', 'test-output', 'data', '.git', '__pycache__'}
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    archive.write(workspace / 'workflow_instagram_site_premium.json', 'workflow_instagram_site_premium.json')
    for item in sorted(package.rglob('*')):
        relative = item.relative_to(package)
        if not item.is_file() or any(part in excluded for part in relative.parts) or item.name == '.env':
            continue
        archive.write(item, Path('instagram-site-premium') / relative)
print(target.name)
print('bytes:', target.stat().st_size)
print('sha256:', hashlib.sha256(target.read_bytes()).hexdigest())
