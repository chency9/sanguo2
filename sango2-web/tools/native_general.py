"""1.05+ initialization, transcribed from the static EXE export.

No equipment effects or post-battle experience awards are inferred here.
"""


def experience_threshold(level):
    # 0x409EE0: integer division truncates toward zero.
    return int(level * (137 * (level - 1) - 34) / 2) + 17 if level <= 99 else 9999999


def initial_level(experience):
    # 0x409F73 literally includes index zero and returns 99 after index 98.
    for level in range(99):
        if experience < experience_threshold(level):
            return level - 1
    return 99


def initial_vitals(base_hp, base_mp, strength, intelligence, level):
    # 0x40A020 / 0x40A098, called by 0x42D1A3 after loading BASEEXP.
    mp_stat = intelligence if strength <= intelligence else (strength + intelligence) // 2
    hp = min(32767, max(base_hp, base_hp + int(strength * 2 * level / 100)))
    mp = min(32767, max(base_mp, base_mp + int(mp_stat * 2 * level / 100)))
    return hp, mp


def learning_entries(entries, key):
    # 0x42C61C reads the first eight occurrences, NOT the final dictionary value.
    result = []
    for field, value in entries:
        if field != key:
            continue
        # 0x42C5B8 consumes exactly two tokens; the bandit row has trailing tokens.
        pair = [int(part.strip()) for part in value.split(',')[:2]]
        if len(pair) != 2 or any(n < 0 or n > 255 for n in pair):
            raise ValueError(f'Invalid {key} learning pair: {value}')
        result.append({'level': pair[0], 'sequence': pair[1]})
        if len(result) == 8:
            break
    return result
