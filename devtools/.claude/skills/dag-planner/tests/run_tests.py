#!/usr/bin/env python3
"""Run every dag-planner test and write per-test evidence as JSON.

  python3 tests/run_tests.py [--out results.json]
Each record: id, requirement, description, status (PASS/FAIL/SKIP), duration_s, evidence.
"""
import argparse
import json
import sys
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True


class Recorder(unittest.TextTestResult):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.records, self._t = [], {}

    def startTest(self, test):
        self._t[test.id()] = time.perf_counter()
        super().startTest(test)

    def _rec(self, test, status, evidence=""):
        name = test.id().split(".")[-1]
        tid = name.split("_")[1] if name.startswith("test_") else name
        doc = (test.shortDescription() or "").split(" ", 1)
        self.records.append({"id": tid, "requirement": doc[0], "description": doc[1] if len(doc) > 1 else "",
                             "status": status, "duration_s": round(time.perf_counter() - self._t.get(test.id(), 0), 3),
                             "evidence": evidence[-600:]})

    def addSuccess(self, test):
        super().addSuccess(test)
        self._rec(test, "PASS", "assertions held")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._rec(test, "FAIL", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self._rec(test, "FAIL", self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._rec(test, "SKIP", reason)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="test-results.json")
    a = ap.parse_args()
    suite = unittest.defaultTestLoader.discover(str(HERE), pattern="test_*.py")
    t0 = time.perf_counter()
    res = unittest.TextTestRunner(resultclass=Recorder, verbosity=1).run(suite)
    recs = sorted(res.records, key=lambda r: r["id"])
    summary = {s: sum(1 for r in recs if r["status"] == s) for s in ("PASS", "FAIL", "SKIP")}
    out = {"python": sys.version.split()[0], "platform": sys.platform, "wall_s": round(time.perf_counter() - t0, 2),
           "summary": summary, "tests": recs}
    Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary))
    return 0 if not summary["FAIL"] else 1


if __name__ == "__main__":
    sys.exit(main())
