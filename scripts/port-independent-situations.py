"""One-time, offline split of schema-2 Situations; never creates Reviews."""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path
import re
import sys
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from state_model import digest, validate_situation, session_alteration
from situations import SituationStore

def port(root, apply=False):
    root = Path(root).resolve()
    data = root / '.layout-lab'
    writes, deletes, mapping = {}, [], {}
    preset_sets = {}
    resolver = SituationStore(root / 'library/situations', data, create=False)
    ids = set()
    groups = {}
    for folder in [root / 'library/situations', data / 'situations']:
        for path in sorted(folder.rglob('*.json')):
            if not path.resolve().is_relative_to(folder.resolve()):
                raise ValueError('Situation path escapes library')
            s = json.loads(path.read_text(encoding='utf-8'))
            if s['id'] in ids:
                raise ValueError('Duplicate Situation ID: ' + s['id'])
            ids.add(s['id'])
            resolver._decision({**s, 'origin': 'library' if folder == root / 'library/situations' else 'local'})
            if s.get('schema') == 3:
                validate_situation(s)
                continue
            if s.get('schema') != 2 or s.get('kind') != 'situation':
                raise ValueError('Expected schema-2 Situation: ' + str(path))
            groups.setdefault((folder, s['decisionStateId']), []).append((path, s))
    for (folder, state), values in groups.items():
        presets_file = root / 'library/presentations.json' if folder == root / 'library/situations' else data / 'presentation-templates.json'
        if presets_file not in preset_sets:
            preset_sets[presets_file] = json.loads(presets_file.read_text(encoding='utf-8')) if presets_file.exists() else []
        presets = preset_sets[presets_file]
        known = {p['id'] for p in presets}
        values.sort(key=lambda pair: (len(pair[1]['id']), pair[1]['id']))
        path, primary = values[0]
        record = copy.deepcopy(primary)
        record['schema'] = 3
        record.pop('presentation', None)
        record['name'] = re.split(r'\s+[—–]\s+(?:desktop|mobile)\b', record['name'], flags=re.I)[0]
        record['tags'] = sorted({t for _, s in values for t in s.get('tags', []) if not t.startswith(('panel:', 'ui:', 'viewpoint:', 'renderer:'))})
        record['description'] = record['name'].rstrip('.') + '. ' + ('Waiting for ' + str(record.get('summary', {}).get('responder')) + '.' if record.get('summary', {}).get('responder') else 'Load in any Layout to inspect the game state.')
        record.pop('migration', None)
        provenance = record.get('provenance', {})
        for key in ['slots', 'references', 'source_slot', 'sourceSlot']:
            provenance.pop(key, None)
        validate_situation(record)
        writes[path] = record
        for oldpath, old in values:
            mapping[old['id']] = record['id']
            saved = old.get('presentation')
            if saved is not None:
                saved = session_alteration(saved, resolver._decision({**old, "origin": "library" if folder == root / "library/situations" else "local"}))
                if not saved["sessionState"]: continue
                identity = digest(saved)[:24]
                if identity not in known:
                    presets.append({'schema': 2, 'id': identity, 'name': old['name'], 'state': saved})
                    known.add(identity)
            if oldpath != path:
                deletes.append(oldpath)
    for presets_file, presets in preset_sets.items():
        writes[presets_file] = presets
    if mapping:
        mapping_file = data / 'situation-id-mapping.json'
        previous = json.loads(mapping_file.read_text(encoding='utf-8')) if mapping_file.exists() else {}
        writes[mapping_file] = {**previous, **mapping}
    # Suggested Layouts from the old importer encode game-specific seats and
    # duplicate arrangements. Curated built-ins replace only these generated files.
    removed_layouts = 0
    for path in (root / 'library/layouts').glob('*.json'):
        value = json.loads(path.read_text(encoding='utf-8'))
        if value.get('name', '').endswith(' - suggested layout'):
            deletes.append(path)
            removed_layouts += 1
    result = {'situationsBefore': sum(len(v) for v in groups.values()), 'situationsAfter': len(groups), 'presentationPresets': sum(len(p) for p in preset_sets.values()), 'mapping': mapping, 'filesWritten': len(writes), 'duplicatesRemoved': len(deletes) - removed_layouts, 'suggestedLayoutsRemoved': removed_layouts}
    if apply and (writes or deletes):
        backup = data / 'migrations' / ('independent-' + uuid.uuid4().hex)
        backup.mkdir(parents=True)
        manifest = {'result': result, 'files': []}
        for i, path in enumerate(dict.fromkeys([*writes, *deletes])):
            if not path.resolve().is_relative_to(root):
                raise ValueError('Port target escapes repository')
            copy_path = backup / (str(i) + '.json')
            if path.exists():
                copy_path.write_bytes(path.read_bytes())
            manifest['files'].append({'path': str(path.relative_to(root)), 'backup': copy_path.name if path.exists() else None})
        (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        for path, value in writes.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix('.port-tmp')
            temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
            temp.replace(path)
        for path in deletes:
            path.unlink()
        result['backup'] = str(backup)
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(port(args.root, args.apply), indent=2))
