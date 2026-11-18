import re

from .sources import current_scene

BURIAL = re.compile(
    r'\b(?:могил\w*|надгроб\w*|кладбищ\w*|захорон\w*|похорон\w*|'
    r'погреб(?:ени|альн)\w*|траур\w*|колумбар\w*|склеп\w*|некропол\w*|'
    r'cemeter(?:y|ies)|graves?|gravestones?|headstones?|tombs?|tombstones?|'
    r'burials?|funerals?|churchyards?)\b', re.IGNORECASE)


def burial_context(scene):
    if not isinstance(scene, dict):
        return False
    text = [scene.get(key, '') for key in ('searchText', 'visionText')]
    facts = scene.get('facts', [])
    if isinstance(facts, list):
        text.extend(fact for fact in facts if isinstance(fact, str))
    return bool(BURIAL.search(' '.join(value for value in text if isinstance(value, str))))


def eligible_assets(owner, registry, assets, scenes):
    scope = 'album-exclusions:' + owner.id
    allowed, excluded, waiting = [], [], []
    for asset in assets:
        scene = scenes.get(asset['id'])
        checksum = asset['checksum']
        if isinstance(scene, dict) and scene.get('sourceChecksum') == checksum and burial_context(scene):
            evidence = {'reason': 'burial', 'asset_id': asset['id'], 'source_checksum': checksum}
            if registry.get(scope, checksum) != evidence:
                registry.put(scope, checksum, evidence)
        if registry.get(scope, checksum):
            excluded.append(asset['id'])
        elif current_scene(asset, scene):
            allowed.append(asset)
        else:
            waiting.append(asset['id'])
    return allowed, excluded, waiting
