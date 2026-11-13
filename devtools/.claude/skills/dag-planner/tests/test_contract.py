"""Contract, simulation and security tests (C01-C10, X01-X08). CLI-level, temp plan home."""
import hashlib
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from helpers import FIXTURES, NOW_ISO, SCRIPTS, SKILL, blk, cli, doc

import export as ex

BASE = ex.find_base_skills()
POSIX = os.name == "posix"
ACCTS = "clp1,clp2,cop1,cop2:40"


def tree_sha(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file() and "__pycache__" not in x.parts):
        h.update(str(p.relative_to(root)).encode() + p.read_bytes())
    return h.hexdigest()


@unittest.skipIf(BASE is None, "base skills (agent-team/clp/cop) not found")
class ContractTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="dagplan-test-"))

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def plan(self, name="meow", fixture=FIXTURES / "sample8.json", accounts=ACCTS):
        rc, out, err = cli(["plan", name, "--blocks", str(fixture), "--accounts", accounts, "--now", NOW_ISO], self.home)
        return rc, out + err

    def load(self, name, f):
        return json.loads((self.home / name / f).read_text(encoding="utf-8"))

    def test_C01_valid_export_accepted_by_agent_team(self):
        """SPEC-T6 graph.json passes agent-team graph.expand()"""
        self.assertEqual(self.plan()[0], 0)
        rc, out, err = cli(["export", "meow"], self.home)
        self.assertEqual(rc, 0, err)
        self.assertIn("accepted by agent-team graph.expand()", out)

    def test_C02_blocked_plan_not_exported(self):
        """REQ-EXP-2 BLOCKED plan cannot be exported"""
        rc, _ = self.plan(accounts="clp1")          # Codex blocks impossible
        self.assertEqual(rc, 1)
        rc, _, err = cli(["export", "meow"], self.home)
        self.assertEqual(rc, 1)
        self.assertIn("BLOCKED", err)

    def test_C03_invalid_graph_rejected(self):
        """REQ-EXP-3 a graph agent-team refuses (relative cwd) raises a clean error"""
        with self.assertRaises(Exception) as cm:
            ex.validate_with_agent_team({"nodes": [{"id": "a", "prompt": "x", "cwd": "rel"}]}, BASE)
        self.assertIn("rejected", str(cm.exception))

    def test_C04_blocks_changed_after_plan(self):
        """REQ-EXP-4 export refuses when blocks.json differs from the planned version"""
        self.plan()
        f = self.home / "meow" / "blocks.json"
        d = json.loads(f.read_text(encoding="utf-8"))
        d["goal"] += " changed"
        f.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        rc, _, err = cli(["export", "meow"], self.home)
        self.assertEqual(rc, 1)
        self.assertIn("changed after planning", err)

    def test_C05_schemas(self):
        """REQ-EXP-1 plan.json / blocks.json match the shipped JSON Schemas"""
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema not installed (stdlib-only host)")
        self.plan()
        for data, sch in ((self.load("meow", "plan.json"), "plan.schema.json"),
                          (json.loads((FIXTURES / "sample8.json").read_text(encoding="utf-8")), "blocks.schema.json")):
            jsonschema.validate(data, json.loads((SKILL / "schemas" / sch).read_text(encoding="utf-8")))

    def test_C06_dag_gantt_export_consistent(self):
        """REQ-CON-1 DAG, Gantt and graph.json all derive from plan.json"""
        self.plan()
        cli(["export", "meow"], self.home)
        plan, graph = self.load("meow", "plan.json"), self.load("meow", "graph.json")
        gantt = (self.home / "meow" / "gantt-plan.svg").read_text(encoding="utf-8")
        dag = (self.home / "meow" / "dag.svg").read_text(encoding="utf-8")
        for bid, r in plan["blocks"].items():
            self.assertIn("+".join(p["account"] for p in r["roles"]), dag)
            self.assertEqual(gantt.count(f">{bid}"), len(r["roles"]), bid)
        self.assertEqual({n["id"]: n["depends_on"] for n in graph["nodes"]}, plan["effective_deps"])
        self.assertEqual(graph["dagplan"]["workers"], plan["accounts_used"])
        for n in graph["nodes"]:
            if n.get("type") in ("debate", "best_of"):
                roles = plan["blocks"][n["id"]]["roles"]
                self.assertEqual(n["judge"], roles[-1]["account"])

    def test_C07_prompt_placeholder_injection(self):
        """REQ-SEC-4 '{{x}}' in block text cannot become an agent-team placeholder"""
        d = doc(blk("A", title="steal {{file:B}}", output="a.md"), blk("B", ["A"]), goal="{{A}}")
        f = self.home / "inj.json"
        f.write_text(json.dumps(d), encoding="utf-8")
        self.assertEqual(self.plan("inj", f, "clp1")[0], 0)
        rc, _, err = cli(["export", "inj"], self.home)
        self.assertEqual(rc, 0, err)
        self.assertNotIn("{{", (self.home / "inj" / "graph.json").read_text(encoding="utf-8"))

    def test_C08_dag_detects_errors_cli(self):
        """SPEC-T2 `dag` exits 1 and names cycle / duplicate / missing / unknown skill"""
        bad = doc(blk("A", ["C"]), blk("B", ["A"]), blk("C", ["B"]), blk("D", ["Z"]), blk("D"), blk("E", skill="x"))
        f = self.home / "bad.json"
        f.write_text(json.dumps(bad), encoding="utf-8")
        rc, _, err = cli(["dag", "bad", "--blocks", str(f)], self.home)
        self.assertEqual(rc, 1)
        for word in ("duplicate", "unknown skill"):
            self.assertIn(word, err)
        bad2 = doc(blk("A", ["C"]), blk("B", ["A"]), blk("C", ["B"]), blk("D", ["Z"]))
        f.write_text(json.dumps(bad2), encoding="utf-8")
        _, _, err2 = cli(["dag", "bad", "--blocks", str(f)], self.home)
        self.assertIn("unknown dependency 'Z'", err2)
        f.write_text(json.dumps(doc(blk("A", ["C"]), blk("B", ["A"]), blk("C", ["B"]))), encoding="utf-8")
        _, _, err3 = cli(["dag", "bad", "--blocks", str(f)], self.home)
        self.assertIn("cycle", err3)

    def test_C12_reply_only_blocks_contract(self):
        """REQ-EXP-5 debate/best_of nodes do not promise an app/ file; dependants read {{file:id}}"""
        self.assertEqual(self.plan()[0], 0)
        cli(["export", "meow"], self.home)
        nodes = {n["id"]: n for n in self.load("meow", "graph.json")["nodes"]}
        self.assertIn("Do not create files", nodes["B02"]["prompt"])
        self.assertNotIn("Write your result", nodes["B06"]["prompt"])
        self.assertIn("{{file:B02}}", nodes["B03"]["prompt"])
        self.assertIn("{{file:B06}}", nodes["B08"]["prompt"])

    def test_C13_run_refuses_stale_graph(self):
        """REQ-EXP-4 run refuses a graph.json exported before a re-plan"""
        self.plan()
        cli(["export", "meow"], self.home)
        p = self.home / "meow" / "plan.json"
        d = json.loads(p.read_text(encoding="utf-8"))
        d["blocks_sha256"] = "0" * 64
        p.write_text(json.dumps(d), encoding="utf-8")
        rc, _, err = cli(["run", "meow"], self.home)
        self.assertEqual(rc, 1)
        self.assertIn("stale", err)

    def test_C09_dag_svg_skill_badges(self):
        """SPEC-T3 dag.svg shows all six skill badges, critical edges and a legend"""
        rc, out, err = cli(["dag", "meow", "--blocks", str(FIXTURES / "sample8.json")], self.home)
        self.assertEqual(rc, 0, err)
        svg = (self.home / "meow" / "dag.svg").read_text(encoding="utf-8")
        for label in ("yolo · Claude", "cyolo · Codex", "image · Codex", "review · 2 CLIs", "debate · 3 accts", "best_of · N+1"):
            self.assertGreaterEqual(svg.count(label), 2, label)   # box badge + legend
        self.assertIn('stroke="#dc5a1e" stroke-width="3.5"', svg)
        self.assertIn("B01 → B04 → B07 → B08", out)


@unittest.skipIf(BASE is None or not POSIX, "simulated agent-team run needs base skills on a POSIX host")
class SimulationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="dagplan-sim-"))
        cls.canary = cls.home / "canary-shared-agent-team"   # caller's AGENT_TEAM_HOME: must stay untouched
        cls.base_before = tree_sha(BASE)
        cli(["plan", "meow", "--blocks", str(FIXTURES / "sample8.json"), "--accounts", ACCTS, "--now", NOW_ISO], cls.home)
        cli(["export", "meow"], cls.home)
        cls.plan_before = (cls.home / "meow" / "plan.json").read_bytes()
        cls.run_rc, cls.run_out, cls.run_err = cli(["run", "meow"], cls.home, extra_env={"AGENT_TEAM_HOME": str(cls.canary)})
        cls.rep_rc, cls.rep_out, cls.rep_err = cli(["report", "meow"], cls.home)
        cls.meta = json.loads((cls.home / "meow" / "run.json").read_text(encoding="utf-8"))
        cls.run_dir = Path(cls.meta["agent_team_home"]) / cls.meta["run_id"]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.home, ignore_errors=True)

    def test_C10_simulator_run_and_report(self):
        """SPEC-T7 run→report without tokens: statuses == state.json, tokens == ledger, files written"""
        self.assertEqual((self.run_rc, self.rep_rc), (0, 0), self.run_err + self.rep_err)
        state = json.loads((self.run_dir / "state.json").read_text(encoding="utf-8"))
        report = (self.home / "meow" / "REPORT.md").read_text(encoding="utf-8")
        for bid in ("B01", "B02", "B08"):
            self.assertRegex(report, rf"\| {bid} \|[^\n]*\| {state['nodes'][bid]['status']} \|")
        ledger = [json.loads(x) for x in (self.run_dir / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(sum(int(r.get("input_tokens") or 0) + int(r.get("output_tokens") or 0) for r in ledger), 0)
        for f in ("gantt-actual.svg", "compare.svg", "REPORT.md"):
            self.assertTrue((self.home / "meow" / f).is_file(), f)

    def test_C11_planned_vs_actual_separate(self):
        """REQ-CON-2 plan.json untouched by run/report; report labels simulated time"""
        self.assertEqual((self.home / "meow" / "plan.json").read_bytes(), self.plan_before)
        self.assertIn("SIMULATION", (self.home / "meow" / "REPORT.md").read_text(encoding="utf-8"))
        self.assertFalse((self.home / "calib.json").exists())

    def test_X01_simulation_enforced_at_runtime(self):
        """REQ-SEC-1 run used private home, MA_SIMULATE_LIMIT on every worker, shimmed PATH"""
        self.assertEqual(self.meta["mode"], "simulation")
        self.assertIn(str(self.home), self.meta["agent_team_home"])
        events = [json.loads(x) for x in (self.run_dir / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertTrue(events and all("SIMULATED" in (r.get("error") or "") for r in events))

    def test_X02_real_executor_count_zero(self):
        """REQ-SEC-2 shim counter == 0, and the shim really counts (positive control)"""
        self.assertEqual(self.meta["real_executor_invocations"], 0)
        import subprocess
        shim = Path(self.meta["sandbox"]) / "shim" / "clp1"
        subprocess.run([str(shim), "-p", "x"], check=False)
        import runner
        self.assertEqual(runner.shim_count(Path(self.meta["sandbox"])), 1)

    def test_X03_real_refused_in_simulation_only_session(self):
        """REQ-SEC-1 --real refused when DAGPLAN_SIMULATE_ONLY=1"""
        rc, _, err = cli(["run", "meow", "--real"], self.home)
        self.assertEqual(rc, 1)
        self.assertIn("refused", err)

    def test_X04_shared_agent_team_untouched(self):
        """REQ-SEC-5 the caller's AGENT_TEAM_HOME (canary) is never created or written by a simulated run"""
        self.assertFalse(self.canary.exists())
        self.assertNotIn(str(self.canary), self.meta["agent_team_home"])

    def test_X05_base_skills_unchanged(self):
        """REQ-SEC-6 base skill files byte-identical before/after the test run"""
        self.assertEqual(tree_sha(BASE), self.base_before)


class RunnerUnitTests(unittest.TestCase):
    def test_C14_actual_bars_tokens_status_synthetic(self):
        """REQ-REP-1 report mapping: sub-nodes (B__1, B.r1.work) fold into their block; tokens summed from ledger"""
        import runner
        ids = {"A", "R", "D"}
        state = {"nodes": {
            "A": {"status": "ok", "account": "clp1", "started": "2026-11-13T09:00:00+07:00", "finished": "2026-11-13T09:10:00+07:00"},
            "R": {"status": "ok", "account": "clp2", "started": "2026-11-13T09:10:00+07:00", "finished": "2026-11-13T09:30:00+07:00"},
            "D__1": {"status": "ok", "account": "clp1", "started": "2026-11-13T09:10:00+07:00", "finished": "2026-11-13T09:15:00+07:00"},
            "D": {"status": "failed", "reason": "x", "account": "cop1", "started": "2026-11-13T09:15:00+07:00", "finished": "2026-11-13T09:16:00+07:00"}}}
        ledger = [{"node": "A", "input_tokens": 10, "output_tokens": 5}, {"node": "R.r1.work", "input_tokens": 7},
                  {"node": "R.r1.review", "output_tokens": 3}, {"node": "D__1", "input_tokens": 1}]
        bars = runner.actual_bars(state, ids)
        self.assertEqual([(b["block"], b["start"], b["end"]) for b in bars if b["node"] == "R"], [("R", 10.0, 30.0)])
        self.assertEqual(runner.block_tokens(ledger, ids), {"A": 15, "R": 10, "D": 1})
        st = runner.block_status(state, ids)
        self.assertEqual((st["D"]["status"], st["D"]["accounts"]), ("failed", ["clp1", "cop1"]))


class StaticSecurityTests(unittest.TestCase):
    SRC = {p.name: p.read_text(encoding="utf-8") for p in SCRIPTS.glob("*.py")}

    def test_X06_no_eval_or_shell(self):
        """REQ-SEC-3 no eval/exec/shell=True/os.system in scripts"""
        for name, text in self.SRC.items():
            self.assertIsNone(re.search(r"\beval\(|\bexec\(|shell=True|os\.system|os\.popen", text), name)

    def test_X07_no_credential_or_auth_access(self):
        """REQ-SEC-7 scripts never reference credential files or login/auth commands"""
        pat = re.compile(r"\.credentials\.json|\.claude\.json|auth\.json|\"auth\",|\"login\"|api[_-]?key", re.I)
        for name, text in self.SRC.items():
            self.assertIsNone(pat.search(text), name)

    def test_X08_frontmatter(self):
        """REQ-SKL-1 SKILL.md has name + bilingual description with trigger phrases"""
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        fm = text.split("---")[1]
        self.assertIn("name: dag-planner", fm)
        for w in ("วางแผนงาน", "แตกงานเป็น DAG", "Gantt", "Use when"):
            self.assertIn(w, fm)


if __name__ == "__main__":
    unittest.main()
