"""Scheduling / AT-QUEST tests (S01-S18). Synthetic accounts, fixed clock."""
import json
import unittest

from helpers import blk, doc, sample8, schedule, snap

import atquest as aq
import schedule as sc


def planned(res, bid):
    return res["blocks"][bid]


def accts(res, bid):
    return [p["account"] for p in res["blocks"][bid]["roles"]]


class ScheduleTests(unittest.TestCase):
    def test_S01_single_available_account(self):
        """REQ-SCH-1 one account: every Claude block planned on it, validator clean"""
        res, _, v = schedule(doc(blk("A"), blk("B", ["A"]), blk("C", ["A"])), [snap("clp1")])
        self.assertEqual(v, [])
        self.assertTrue(all(accts(res, b) == ["clp1"] for b in "ABC"))

    def test_S02_multiple_eligible_accounts(self):
        """REQ-ATQ-1 several eligible accounts: winner = top AT-QUEST score, runner-ups listed"""
        res, _, _ = schedule(doc(blk("A", size="L")), [snap("clp1", 50), snap("clp2", 100)])
        role = planned(res, "A")["roles"][0]
        self.assertEqual(role["account"], "clp2")
        self.assertTrue(role["alts"] and role["alts"][0].startswith("clp1"))

    def test_S03_no_available_account(self):
        """REQ-SCH-6 Codex-only block with only Claude accounts -> unassigned (BLOCKED)"""
        res, _, _ = schedule(doc(blk("A", skill="cyolo"), blk("B", ["A"])), [snap("clp1")])
        self.assertEqual([planned(res, x)["status"] for x in "AB"], ["unassigned", "unassigned"])
        self.assertIn("Codex", planned(res, "A")["why"])

    def test_S04_account_capacity_conflict(self):
        """REQ-SCH-2 per-account 1 slot: two parallel blocks are serialised on the same account"""
        res, _, v = schedule(doc(blk("A"), blk("B")), [snap("clp1")], per_account=1)
        self.assertEqual(v, [])
        a, b = planned(res, "A"), planned(res, "B")
        self.assertTrue(a["end"] <= b["start"] or b["end"] <= a["start"])

    def test_S05_team_concurrency_limit(self):
        """REQ-SCH-3 --max-agents 1 never overlaps; a 3-account debate under --max-agents 2 is unassigned"""
        res, _, v = schedule(doc(blk("A"), blk("B"), blk("C")), [snap("clp1"), snap("clp2")], max_agents=1)
        self.assertEqual(v, [])
        spans = sorted((r["start"], r["end"]) for r in res["blocks"].values())
        self.assertTrue(all(spans[i][1] <= spans[i + 1][0] for i in range(2)))
        res2, _, _ = schedule(doc(blk("D", skill="debate")), [snap("clp1"), snap("clp2"), snap("cop1")], max_agents=2)
        self.assertEqual(planned(res2, "D")["status"], "unassigned")
        self.assertIn("max-agents", planned(res2, "D")["why"])

    def test_S06_urgent_task_priority(self):
        """REQ-ATQ-4 contention for one slot: the block with the higher critical rank starts first"""
        d = doc(blk("A"), blk("B"), blk("C", ["B"], size="L"))
        res, _, _ = schedule(d, [snap("clp1")], per_account=1)
        self.assertEqual(planned(res, "B")["start"], 0.0)
        self.assertGreater(planned(res, "A")["start"], 0.0)

    def test_S07_expiry_urgency_prefers_soon_expiring(self):
        """REQ-ATQ-5 U factor: account whose quota resets sooner is used first (use-it-or-lose-it)"""
        res, scored, _ = schedule(doc(blk("A")), [snap("clp1", week_reset=160), snap("clp2", week_reset=10)])
        self.assertEqual(accts(res, "A"), ["clp2"])
        u = {q["account"]: q["use_first"] for q in scored}
        self.assertGreater(u["clp2"], u["clp1"])

    def test_S08_quota_unavailable(self):
        """REQ-ATQ-3 account at 99 % session use gets no slot -> block BLOCKED"""
        res, scored, _ = schedule(doc(blk("A")), [snap("clp1", 1)])
        self.assertEqual(scored[0]["slots"], 0)
        self.assertEqual(planned(res, "A")["status"], "unassigned")

    def test_S09_unknown_quota_not_available(self):
        """REQ-ATQ-6 session usage UNKNOWN -> not eligible (never treated as available)"""
        res, scored, _ = schedule(doc(blk("A")), [snap("clp1", session_used=None)])
        self.assertFalse(scored[0]["eligible"])
        self.assertIn("UNKNOWN", scored[0]["reason"])
        self.assertEqual(planned(res, "A")["status"], "unassigned")

    def test_S10_expired_resource(self):
        """REQ-ATQ-5 plan already expired -> hard-excluded before scoring"""
        _, scored, _ = schedule(doc(blk("A")), [snap("clp1", plan_expires=-1), snap("clp2")])
        self.assertIn("EXPIRED", {q["account"]: q["reason"] for q in scored}["clp1"])

    def test_S11_unknown_expiry(self):
        """REQ-ATQ-5 no reset/expiry known -> reference 7-day default, flagged expiry_unknown"""
        _, scored, _ = schedule(doc(blk("A")), [snap("clp1", week_reset=None)])
        self.assertTrue(scored[0]["eligible"] and scored[0]["expiry_unknown"])
        self.assertEqual(scored[0]["hours_left"], 168.0)

    def test_S12_unknown_readiness_excluded(self):
        """REQ-ATQ-6 readiness unknown/expired/not_logged_in -> excluded"""
        _, scored, _ = schedule(doc(blk("A")), [snap("clp1", state="unknown"), snap("clp2", state="not_logged_in")])
        self.assertEqual([q["eligible"] for q in scored], [False, False])

    def test_S13_file_ownership_conflict(self):
        """REQ-SCH-4 two unordered blocks writing the same output never overlap"""
        res, _, v = schedule(doc(blk("A", output="x.md"), blk("B", output="x.md")), [snap("clp1"), snap("clp2")])
        self.assertEqual(v, [])
        a, b = planned(res, "A"), planned(res, "B")
        self.assertTrue(a["end"] <= b["start"] or b["end"] <= a["start"])

    def test_S14_infeasible_schedule(self):
        """REQ-SCH-6 L block on a 6 % account -> unassigned and its dependants too"""
        res, _, _ = schedule(doc(blk("A", size="L"), blk("B", ["A"])), [snap("clp1", 6)])
        self.assertEqual(planned(res, "B")["why"], "waits on unassigned A")

    def test_S15_deterministic(self):
        """REQ-SCH-5 same input + clock -> byte-identical schedule (10 runs)"""
        snaps = [snap("clp1"), snap("clp2", 60), snap("cop1"), snap("cop2", 40)]
        outs = {json.dumps(schedule(sample8(), snaps)[0], sort_keys=True) for _ in range(10)}
        self.assertEqual(len(outs), 1)

    def test_S16_low_quota_account_avoids_big_block(self):
        """SPEC-T5 what-if: account with little quota gets no L block"""
        res, _, v = schedule(sample8(), [snap("clp1", 8), snap("clp2"), snap("cop1"), snap("cop2")])
        self.assertEqual(v, [])
        big = [b["id"] for b in sample8()["blocks"] if b["size"] == "L"]
        self.assertTrue(all("clp1" not in accts(res, b) for b in big))

    def test_S17_sides_review_and_multi_account(self):
        """SPEC-T4 skills on the right CLI; review uses the other CLI; multi-account blocks hold >=2 accounts"""
        d = sample8()
        res, _, v = schedule(d, [snap("clp1"), snap("clp2"), snap("cop1"), snap("cop2")])
        self.assertEqual(v, [])
        for b in d["blocks"]:
            a = accts(res, b["id"])
            if b["skill"] == "yolo":
                self.assertEqual(aq.kind_of(a[0]), "clp")
            if b["skill"] in ("cyolo", "image"):
                self.assertEqual(aq.kind_of(a[0]), "cop")
            if b["skill"] == "review":
                self.assertNotEqual(aq.kind_of(a[0]), aq.kind_of(a[1]))
            if b["skill"] in ("debate", "best_of"):
                self.assertGreaterEqual(len(set(a)), 3)

    def test_S18_validator_catches_violations(self):
        """REQ-VAL-1 independent validator flags slot overrun and dependency break"""
        d = doc(blk("A"), blk("B", ["A"]))
        res, scored, _ = schedule(d, [snap("clp1")])
        bad = json.loads(json.dumps(res["blocks"]))
        bad["B"]["start"] = 0.0
        v = sc.validate_schedule(d["blocks"], bad, {"clp1": 1}, 8)
        self.assertTrue(any("before dependency" in x for x in v))
        self.assertTrue(any("slots" in x for x in v))

    def test_S19_exclusive_runs_alone(self):
        """REQ-SCH-7 exclusive block overlaps nothing; validator flags an injected overlap"""
        d = doc(blk("A"), blk("B"), blk("X", exclusive=True), blk("C"))
        res, _, v = schedule(d, [snap("clp1"), snap("clp2")])
        self.assertEqual(v, [])
        x = planned(res, "X")
        for o in "ABC":
            r = planned(res, o)
            self.assertTrue(r["end"] <= x["start"] or r["start"] >= x["end"], o)
        bad = json.loads(json.dumps(res["blocks"]))
        bad["X"]["start"], bad["X"]["end"] = 0.0, 5.0
        self.assertTrue(any("exclusive" in e for e in sc.validate_schedule(d["blocks"], bad, {"clp1": 3, "clp2": 3}, 8)))

    def test_S20_quota_reservations_within_headroom(self):
        """REQ-ATQ-3 cumulative reserved quota never exceeds starting headroom (validator check)"""
        snaps = [snap("clp1", 30), snap("clp2", 100), snap("cop1", 50), snap("cop2")]
        res, scored, v = schedule(sample8(), snaps)
        self.assertEqual(sc.validate_schedule(sample8()["blocks"], res["blocks"], {q["account"]: q["slots"] for q in scored}, 8, scored), [])
        lowered = [dict(q, headroom_session=0.5) for q in scored]
        self.assertTrue(any("exceeds headroom" in e for e in sc.validate_schedule(sample8()["blocks"], res["blocks"], {q["account"]: q["slots"] for q in scored}, 8, lowered)))


if __name__ == "__main__":
    unittest.main()
