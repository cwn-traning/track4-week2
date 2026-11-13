"""DAG tests (D01-D13): validation, rank and critical path."""
import itertools
import unittest

from helpers import blk, doc, sample8

import blocks as bk


def errs(d):
    return bk.validate(d)[0]


class DagTests(unittest.TestCase):
    def test_D01_empty_graph(self):
        """REQ-DAG-1 empty graph is rejected"""
        self.assertIn("non-empty", errs(doc())[0])

    def test_D02_single_task(self):
        """REQ-DAG-1 single block validates, rank = its size"""
        d = doc(blk("A", size="M"))
        self.assertEqual(errs(d), [])
        self.assertEqual(bk.ranks(d["blocks"], bk.declared_deps(d["blocks"])), {"A": 1.5})

    def test_D03_sequential(self):
        """REQ-DAG-2 chain A->B->C: rank accumulates, critical path is the chain"""
        d = doc(blk("A"), blk("B", ["A"]), blk("C", ["B"]))
        deps = bk.declared_deps(d["blocks"])
        r = bk.ranks(d["blocks"], deps)
        self.assertEqual(r, {"A": 1.8, "B": 1.2, "C": 0.6})
        self.assertEqual(bk.critical_path(d["blocks"], deps, r), ["A", "B", "C"])

    def test_D04_parallel(self):
        """REQ-DAG-2 independent blocks all at level 0"""
        d = doc(blk("A"), blk("B"), blk("C"))
        self.assertEqual(set(bk.levels(d["blocks"], bk.declared_deps(d["blocks"])).values()), {0})

    def test_D05_diamond(self):
        """REQ-DAG-2 diamond A->(B,C)->D: critical path through the larger branch"""
        d = doc(blk("A"), blk("B", ["A"], size="L"), blk("C", ["A"]), blk("D", ["B", "C"]))
        deps = bk.declared_deps(d["blocks"])
        self.assertEqual(bk.critical_path(d["blocks"], deps, bk.ranks(d["blocks"], deps)), ["A", "B", "D"])

    def test_D06_multiple_dependencies(self):
        """REQ-DAG-2 block with 3 deps waits on all of them"""
        d = doc(blk("A"), blk("B"), blk("C"), blk("D", ["A", "B", "C"]))
        self.assertEqual(errs(d), [])
        self.assertEqual(bk.topo_order(d["blocks"], bk.declared_deps(d["blocks"]))[-1], "D")

    def test_D07_cycle(self):
        """REQ-DAG-3 cycle A->B->C->A detected"""
        e = errs(doc(blk("A", ["C"]), blk("B", ["A"]), blk("C", ["B"])))
        self.assertTrue(any("cycle" in x and "A, B, C" in x for x in e), e)

    def test_D08_self_dependency(self):
        """REQ-DAG-3 self dependency detected"""
        self.assertTrue(any("depends on itself" in x for x in errs(doc(blk("A", ["A"])))))

    def test_D09_duplicate_id(self):
        """REQ-DAG-3 duplicate id detected"""
        self.assertTrue(any("duplicate" in x for x in errs(doc(blk("A"), blk("A")))))

    def test_D10_missing_dependency(self):
        """REQ-DAG-3 reference to a non-existent id detected"""
        self.assertTrue(any("unknown dependency 'Z'" in x for x in errs(doc(blk("A", ["Z"])))))

    def test_D11_unknown_skill(self):
        """REQ-DAG-3 unsupported skill rejected"""
        self.assertTrue(any("unknown skill" in x for x in errs(doc(blk("A", skill="gpt")))))

    def test_D12_rank_and_critical_path_independent(self):
        """REQ-DAG-4 sample8: rank == brute-force longest path; critical path == heaviest root-to-sink path"""
        d = sample8()
        self.assertEqual(errs(d), [])
        deps = bk.declared_deps(d["blocks"])
        cost = {b["id"]: bk.SIZE_MTOK[b["size"]] for b in d["blocks"]}
        succ = bk.successors(d["blocks"], deps)

        def paths(i):
            return [[i]] if not succ[i] else [[i] + p for k in succ[i] for p in paths(k)]
        brute = {i: round(max(sum(cost[x] for x in p) for p in paths(i)), 3) for i in cost}
        r = bk.ranks(d["blocks"], deps)
        self.assertEqual(r, brute)
        roots = [i for i in cost if not deps[i]]
        heaviest = max((p for i in roots for p in paths(i)), key=lambda p: sum(cost[x] for x in p))
        self.assertEqual(bk.critical_path(d["blocks"], deps, r), heaviest)
        self.assertEqual(heaviest, ["B01", "B04", "B07", "B08"])
        self.assertEqual(sorted({b["skill"] for b in d["blocks"]}), sorted(bk.SKILLS))

    def test_D13_exclusive_edges_never_cycle(self):
        """REQ-DAG-5 exclusivity edges keep the graph acyclic for every exclusive placement"""
        for combo in itertools.product([False, True], repeat=4):
            d = doc(blk("A", exclusive=combo[0]), blk("B", ["A"], exclusive=combo[1]),
                    blk("C", exclusive=combo[2]), blk("D", ["B", "C"], exclusive=combo[3]))
            eff = bk.effective_deps(d["blocks"])
            self.assertEqual(bk.find_cycle([dict(b, depends_on=eff[b["id"]]) for b in d["blocks"]]), [])

    def test_D14_unsafe_output_path(self):
        """REQ-SEC-3 output escaping app/ rejected"""
        self.assertTrue(any("relative path" in x for x in errs(doc(blk("A", output="../../etc/x")))))


if __name__ == "__main__":
    unittest.main()
