"""Schema-2 split keeps exact checkpoints, separate presets and no generated Reviews."""
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from state_model import decision_state
spec = importlib.util.spec_from_file_location('independent_port', Path(__file__).resolve().parents[1] / 'scripts/port-independent-situations.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def test_port_consolidates_game_moments_preserves_exact_state_and_private_presets():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        state = decision_state({'state': {'teams': {}, 'rng': 2**89 + 17}})
        folder = root / 'library/situations'
        folder.mkdir(parents=True)
        decisions = root / 'library/decision-states'
        decisions.mkdir()
        checkpoint = decisions / (state['id'] + '.json')
        checkpoint.write_text(json.dumps(state), encoding='utf-8')
        original = checkpoint.read_bytes()
        for identity, pane in [('first', 'board'), ('second', 'hand')]:
            (folder / (identity + '.json')).write_text(json.dumps({'schema':2,'kind':'situation','id':identity,'name':'Choose a card — mobile','decisionStateId':state['id'],'tags':['panel:'+pane,'hero:arien'], 'presentation':{'schema':2,'sessionState':{'pane':pane},'userState':{}}}), encoding='utf-8')
        local = root / '.layout-lab/situations'
        local.mkdir(parents=True)
        (local / 'private.json').write_text(json.dumps({'schema':2,'kind':'situation','id':'private','name':'Private camera','decisionStateId':state['id'],'presentation':{'schema':2,'sessionState':{'camera':{'private':True}},'userState':{}}}), encoding='utf-8')
        before = {str(p):p.read_bytes() for p in root.rglob('*.json')}
        dry = module.port(root)
        assert dry['duplicatesRemoved'] == 1
        assert before == {str(p):p.read_bytes() for p in root.rglob('*.json')}
        result = module.port(root, True)
        assert result['situationsAfter'] == 2
        assert len(list(folder.glob('*.json'))) == 1
        saved = json.loads(next(folder.glob('*.json')).read_text())
        assert saved['schema'] == 3 and 'presentation' not in saved
        assert saved['name'] == 'Choose a card'
        assert checkpoint.read_bytes() == original
        shared = json.loads((root / 'library/presentations.json').read_text())
        private = json.loads((root / '.layout-lab/presentation-templates.json').read_text())
        assert len(shared) == 1 and len(private) == 0
        assert all('camera' not in p['state']['sessionState'] for p in shared)
        assert not (root / '.layout-lab/reports/reviews').exists()
        assert Path(result['backup'], 'manifest.json').is_file()
        assert module.port(root, True)['filesWritten'] == 0
