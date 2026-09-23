"""設計モデルの検算。DBの排他・API・永続化の検証ではない。"""
from copy import deepcopy

class Model:
    def __init__(self):
        self.payments = {}
        self.claims = {}
        self.epochs = {}  # 対象の精算・取消履歴の変化を表すモデル上の値
        self.settlements = []

    def add(self, pid, contribution):
        assert pid not in self.payments
        self.payments[pid] = [contribution, False]
        self.epochs[pid] = 0

    def cancel_payment(self, pid):
        self.payments[pid][1] = True

    def candidates(self):
        result = []
        for pid, (value, cancelled) in self.payments.items():
            base = self.claims.get((pid, 'BASE'))
            reversal = self.claims.get((pid, 'REVERSAL'))
            assert reversal is None or base is not None
            if not cancelled and base is None:
                result.append((pid, 'BASE', value))
            elif cancelled and base is not None and reversal is None:
                result.append((pid, 'REVERSAL', -value))
        return result

    def preview(self):
        items = self.candidates()
        assert items, 'NO_TARGETS'
        return (items, {p: self.epochs[p] for p, _, _ in items})

    def complete(self, preview, acknowledge=False):
        items, versions = preview
        for pid, kind, value in items:
            assert self.epochs[pid] == versions[pid], 'TARGET_CHANGED'
            assert (pid, kind) not in self.claims, 'DUPLICATE'
            if kind == 'BASE' and self.payments[pid][1]:
                assert acknowledge, 'ACK_REQUIRED'
        sid = len(self.settlements)
        self.settlements.append([deepcopy(items), False])
        for pid, kind, _ in items:
            self.claims[(pid, kind)] = sid
            self.epochs[pid] += 1
        return sid

    def cancel_settlement(self, sid):
        if self.settlements[sid][1]:
            return
        latest = max(i for i, (_, c) in enumerate(self.settlements) if not c)
        assert sid == latest, 'NOT_LATEST'
        for pid, kind, _ in self.settlements[sid][0]:
            del self.claims[(pid, kind)]
            self.epochs[pid] += 1
        self.settlements[sid][1] = True

    def check(self, expected):
        pending = sum(v for _, _, v in self.candidates())
        obligations = sum(v for v, c in self.payments.values() if not c)
        transfers = sum(sum(v for _, _, v in items)
                        for items, cancelled in self.settlements if not cancelled)
        assert pending == obligations - transfers == expected


def rejects(fn, code):
    try:
        fn()
    except AssertionError as e:
        assert str(e) == code, (e, code)
    else:
        raise AssertionError(f'Expected rejection: {code}')


def run():
    for payment_first in [True, False]:
        m = Model(); m.add('p', 3000); s = m.complete(m.preview())
        if payment_first:
            m.cancel_payment('p'); m.check(-3000); m.cancel_settlement(s)
        else:
            m.cancel_settlement(s); m.check(3000); m.cancel_payment('p')
        m.check(0)
        m.cancel_payment('p'); m.cancel_settlement(s); m.check(0)

    m = Model(); m.add('p', 3000); old = m.preview()
    m.add('new', 2000); m.complete(old); m.check(2000)
    rejects(lambda: m.complete(old), 'TARGET_CHANGED')

    m = Model(); m.add('p', 3000); old = m.preview()
    m.cancel_payment('p'); m.add('correct', 2000)
    rejects(lambda: m.complete(old), 'ACK_REQUIRED')
    s1 = m.complete(old, acknowledge=True); m.check(-1000)
    s2 = m.complete(m.preview()); m.check(0)
    rejects(lambda: m.cancel_settlement(s1), 'NOT_LATEST')
    m.cancel_settlement(s2); m.check(-1000)
    m.cancel_settlement(s1); m.check(2000)
    m.complete(m.preview()); m.check(0)

    m = Model(); m.add('zero', 0); old = m.preview()
    assert len(old[0]) == 1
    s = m.complete(old); assert not m.candidates(); m.check(0)
    m.cancel_payment('zero'); assert len(m.candidates()) == 1
    m.cancel_settlement(s); assert not m.candidates(); m.check(0)

    m = Model(); m.add('p', 3000); old = m.preview()
    s = m.complete(m.preview()); m.cancel_settlement(s)
    rejects(lambda: m.complete(old), 'TARGET_CHANGED')
    m.complete(m.preview()); m.check(0)
    print('PASS: 取消順序・重複取消・追加分の除外・重複完了拒否・受け渡し後の訂正・最新取消・再精算・0円対象・古い確認の拒否')

if __name__ == '__main__':
    run()
