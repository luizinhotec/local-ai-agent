from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT.parent / "state"
OPS_LOG_PATH = STATE_DIR / "aibtc-ops-log.jsonl"
OPS_SUMMARY_PATH = STATE_DIR / "aibtc-ops-summary.json"
REPORTS_DIR = STATE_DIR / "reports"
LATEST_REPORT_PATH = REPORTS_DIR / "aibtc-ops-report-latest.json"
LATEST_BACKUP_META_PATH = STATE_DIR / "aibtc-local-state-backup-latest.json"
LATEST_INTEGRITY_AUDIT_PATH = STATE_DIR / "aibtc-integrity-audit-latest.json"
POSITION_MONITOR_CONFIG_PATH = ROOT.parent / "config" / "speedy-indra-position-monitor.json"
EXPORT_REPORT_SCRIPT = ROOT.parent / "scripts" / "export-aibtc-ops-report.ps1"
REPAIR_STATE_SCRIPT = ROOT.parent / "scripts" / "repair-aibtc-local-state.ps1"
PRUNE_STATE_SCRIPT = ROOT.parent / "scripts" / "prune-aibtc-local-state.ps1"
BACKUP_STATE_SCRIPT = ROOT.parent / "scripts" / "backup-aibtc-local-state.ps1"
RESTORE_STATE_SCRIPT = ROOT.parent / "scripts" / "restore-aibtc-local-state.ps1"
DAILY_CHECK_SCRIPT = ROOT.parent / "scripts" / "run-aibtc-daily-check.ps1"
INTEGRITY_AUDIT_SCRIPT = ROOT.parent / "scripts" / "run-aibtc-integrity-audit.ps1"
MAINTENANCE_CYCLE_SCRIPT = ROOT.parent / "scripts" / "run-aibtc-maintenance-cycle.ps1"
REGISTER_URL = "https://aibtc.com/api/register"
PROXY_TARGETS = {
    "/api/register-proxy": ("POST", REGISTER_URL),
    "/api/identity-proxy": ("GET", "https://aibtc.com/api/identity/{stxAddress}"),
    "/api/verify-proxy": ("GET", "https://aibtc.com/api/verify/{stxAddress}"),
    "/api/heartbeat-proxy": ("GET", "https://aibtc.com/api/heartbeat?address={btcAddress}"),
    "/api/registry-proxy": ("GET", "https://stx402.com/agent/registry"),
}
HIRO_MAINNET_API = "https://api.hiro.so"
SBTC_TOKEN_KEY = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"


class RegisterHelperHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        if self.path == "/api/register-proxy":
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError as exc:
                self._send_json(400, {"error": f"Invalid JSON: {exc}"})
                return
            self._proxy_request(REGISTER_URL, method="POST", payload=payload)
            return
        if self.path == "/api/log-event":
            self._handle_log_event()
            return
        if self.path == "/api/rebuild-ops-summary":
            self._handle_rebuild_ops_summary()
            return
        if self.path == "/api/export-ops-report":
            self._handle_export_ops_report()
            return
        if self.path == "/api/repair-local-state":
            self._handle_run_script(REPAIR_STATE_SCRIPT, ["-ShowStatus"])
            return
        if self.path == "/api/prune-local-state":
            self._handle_run_script(PRUNE_STATE_SCRIPT, [])
            return
        if self.path == "/api/backup-local-state":
            self._handle_run_script(BACKUP_STATE_SCRIPT, [])
            return
        if self.path == "/api/restore-local-state":
            self._handle_run_script(RESTORE_STATE_SCRIPT, ["-UseLatest"])
            return
        if self.path == "/api/run-daily-check":
            self._handle_run_script(DAILY_CHECK_SCRIPT, [])
            return
        if self.path == "/api/run-integrity-audit":
            self._handle_run_script(INTEGRITY_AUDIT_SCRIPT, [])
            return
        if self.path == "/api/run-maintenance-cycle":
            self._handle_run_script(MAINTENANCE_CYCLE_SCRIPT, [])
            return
        self.send_error(404, "Endpoint not found")

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._send_json(200, {"ok": True, "service": "register_helper_server"})
            return
        if self.path.startswith("/api/identity-proxy"):
            self._handle_get_proxy("https://aibtc.com/api/identity/{stxAddress}", ["stxAddress"])
            return
        if self.path.startswith("/api/verify-proxy"):
            self._handle_get_proxy("https://aibtc.com/api/verify/{stxAddress}", ["stxAddress"])
            return
        if self.path.startswith("/api/heartbeat-proxy"):
            self._handle_get_proxy("https://aibtc.com/api/heartbeat?address={btcAddress}", ["btcAddress"])
            return
        if self.path.startswith("/api/registry-proxy"):
            self._proxy_request("https://stx402.com/agent/registry", method="GET")
            return
        if self.path.startswith("/api/logs-proxy"):
            self._handle_logs_proxy()
            return
        if self.path.startswith("/api/ops-summary"):
            self._handle_ops_summary()
            return
        if self.path.startswith("/api/ops-status"):
            self._handle_ops_status()
            return
        if self.path.startswith("/api/ops-report-latest"):
            self._handle_ops_report_latest()
            return

        super().do_GET()

    def _handle_get_proxy(self, template: str, required_keys: list[str]) -> None:
        from urllib.parse import parse_qs, urlparse

        query = parse_qs(urlparse(self.path).query)
        missing = [key for key in required_keys if not query.get(key)]
        if missing:
            self._send_json(400, {"error": f"Missing query parameter(s): {', '.join(missing)}"})
            return

        params = {key: query[key][0] for key in required_keys}
        target = template.format(**params)
        self._proxy_request(target, method="GET")

    def _proxy_request(self, url: str, method: str, payload=None) -> None:
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8")
                parsed = self._safe_parse_json(body)
                self._send_json(response.status, parsed)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            parsed = self._safe_parse_json(body)
            self._send_json(exc.code, parsed)
        except Exception as exc:  # pragma: no cover
            self._send_json(502, {"error": str(exc)})

    def _handle_log_event(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            self._send_json(400, {"error": f"Invalid JSON: {exc}"})
            return

        event_type = payload.get("type")
        if not event_type:
            self._send_json(400, {"error": "Missing field: type"})
            return

        record = self._append_event_record(payload)

        self._send_json(200, {"success": True, "path": str(OPS_LOG_PATH), "record": record})

    def _handle_logs_proxy(self) -> None:
        from urllib.parse import parse_qs, urlparse

        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if not OPS_LOG_PATH.exists():
            self._send_json(200, {"events": []})
            return

        query = parse_qs(urlparse(self.path).query)
        limit_raw = query.get("limit", ["20"])[0]
        event_type = query.get("type", [None])[0]
        try:
            limit = max(1, min(200, int(limit_raw)))
        except ValueError:
            limit = 20

        events = []
        with OPS_LOG_PATH.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event_type and item.get("type") != event_type:
                    continue
                events.append(item)

        self._send_json(200, {"events": events[-limit:]})

    def _handle_rebuild_ops_summary(self) -> None:
        summary = self._rebuild_ops_summary_from_log()
        self._save_ops_summary(summary)
        self._send_json(200, {"success": True, "summary": summary})

    def _handle_ops_summary(self) -> None:
        summary = self._load_ops_summary()
        self._send_json(200, summary)

    def _handle_ops_status(self) -> None:
        summary = self._load_ops_summary()
        registry_snapshot = self._load_registry_snapshot()
        latest_report = self._load_latest_report()
        heartbeat_status = self._build_heartbeat_status(summary)
        registry_status = self._build_registry_status(registry_snapshot)
        report_status = self._build_report_status(summary, latest_report)
        maintenance_status = self._build_maintenance_status(summary)
        maintenance_cycle_status = self._build_maintenance_cycle_status(summary)
        backup_status = self._build_backup_status(summary)
        daily_check_status = self._build_daily_check_status(summary)
        integrity_audit_status = self._build_integrity_audit_status(summary)
        position_status = self._build_position_monitor_status()
        alerts = self._build_operational_alerts(
            heartbeat_status,
            registry_status,
            report_status,
            backup_status,
            daily_check_status,
            integrity_audit_status,
            position_status,
        )
        recommendations = self._build_recommended_actions(
            heartbeat_status,
            registry_status,
            report_status,
            backup_status,
            daily_check_status,
            alerts,
            position_status,
        )
        payload = {
            "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
            "heartbeat": heartbeat_status,
            "viralClaim": self._build_viral_claim_status(summary),
            "registry": registry_status,
            "report": report_status,
            "maintenance": maintenance_status,
            "maintenanceCycle": maintenance_cycle_status,
            "backup": backup_status,
            "dailyCheck": daily_check_status,
            "integrityAudit": integrity_audit_status,
            "position": position_status,
            "alerts": alerts,
            "recommendedActions": recommendations,
            "primaryAction": recommendations[0] if recommendations else None,
            "latestEvent": summary.get("latestEvent"),
            "recentEvents": summary.get("recentEvents") or [],
        }
        self._send_json(200, payload)

    def _handle_ops_report_latest(self) -> None:
        payload = self._load_latest_report()
        if not payload:
            self._send_json(404, {"error": "latest ops report not found"})
            return
        self._send_json(200, payload)

    def _handle_export_ops_report(self) -> None:
        completed = self._run_powershell_script(EXPORT_REPORT_SCRIPT, [])
        if completed is None:
            return
        payload = {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
        if LATEST_REPORT_PATH.exists():
            try:
                payload["latestReport"] = json.loads(LATEST_REPORT_PATH.read_text(encoding="utf-8-sig"))
            except Exception:
                payload["latestReport"] = None
        self._send_json(200 if completed.returncode == 0 else 500, payload)

    def _handle_run_script(self, script_path: Path, script_args: list[str]) -> None:
        completed = self._run_powershell_script(script_path, script_args)
        if completed is None:
            return
        payload = {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
        self._send_json(200 if completed.returncode == 0 else 500, payload)

    def _run_powershell_script(self, script_path: Path, script_args: list[str]):
        if not script_path.exists():
            self._send_json(404, {"error": f"script not found: {script_path.name}"})
            return None
        command = [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            *script_args,
        ]
        try:
            return subprocess.run(
                command,
                cwd=str(ROOT.parent.parent),
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except Exception as exc:
            self._send_json(500, {"error": f"failed to launch script {script_path.name}: {exc}"})
            return None

    def _load_ops_summary(self):
        if not OPS_SUMMARY_PATH.exists():
            summary = self._rebuild_ops_summary_from_log()
            self._save_ops_summary(summary)
            return summary
        try:
            loaded = json.loads(OPS_SUMMARY_PATH.read_text(encoding="utf-8-sig"))
            normalized = self._ensure_summary_shape(loaded)
            if not normalized.get("recentEvents") and OPS_LOG_PATH.exists():
                normalized = self._rebuild_ops_summary_from_log()
                self._save_ops_summary(normalized)
            return normalized
        except Exception:
            summary = self._rebuild_ops_summary_from_log()
            self._save_ops_summary(summary)
            return summary

    def _save_ops_summary(self, summary) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        OPS_SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=True, indent=2), encoding="utf-8")

    def _ensure_summary_shape(self, summary):
        defaults = {
            "updatedAtUtc": None,
            "latestEvent": None,
            "latestHeartbeatSuccess": None,
            "latestHeartbeatAttempt": None,
            "latestViralClaimSuccess": None,
            "latestViralClaimAttempt": None,
            "latestRegistryCheck": None,
            "latestRegistryStateChange": None,
            "latestOpsReportExport": None,
            "latestLocalStateRepair": None,
            "latestLocalStatePrune": None,
            "latestLocalStateBackup": None,
            "latestLocalStateRestore": None,
            "latestDailyCheckRun": None,
            "latestIntegrityAuditRun": None,
            "latestMaintenanceCycleRun": None,
            "heartbeatDiagnostics": None,
            "recentEvents": [],
        }
        normalized = {**defaults, **(summary or {})}
        if normalized.get("recentEvents") is None:
            normalized["recentEvents"] = []
        return normalized

    def _load_registry_snapshot(self):
        snapshot_path = STATE_DIR / "aibtc-mainnet-registry-status.json"
        if not snapshot_path.exists():
            return None
        try:
            return json.loads(snapshot_path.read_text(encoding="utf-8-sig"))
        except Exception:
            return None

    def _load_latest_report(self):
        if not LATEST_REPORT_PATH.exists():
            return None
        try:
            return json.loads(LATEST_REPORT_PATH.read_text(encoding="utf-8-sig"))
        except Exception:
            return None

    def _load_latest_backup_meta(self):
        if not LATEST_BACKUP_META_PATH.exists():
            return None
        try:
            return json.loads(LATEST_BACKUP_META_PATH.read_text(encoding="utf-8-sig"))
        except Exception:
            return None

    def _load_latest_integrity_audit(self):
        if not LATEST_INTEGRITY_AUDIT_PATH.exists():
            return None
        try:
            return json.loads(LATEST_INTEGRITY_AUDIT_PATH.read_text(encoding="utf-8-sig"))
        except Exception:
            return None

    def _summarize_event(self, event):
        details = event.get("details") or {}
        return {
            "loggedAt": event.get("loggedAt"),
            "type": event.get("type"),
            "displayName": event.get("displayName"),
            "btcAddress": event.get("btcAddress"),
            "stxAddress": event.get("stxAddress"),
            "timestampIso": details.get("timestampIso"),
            "postStatus": ((details.get("postResult") or {}).get("status")),
            "resultStatus": ((details.get("result") or {}).get("status")),
            "logStatus": ((details.get("logResult") or {}).get("status")),
            "registryStatus": (((details.get("result") or {}).get("status"))),
            "reportGeneratedAtUtc": ((details.get("latestReport") or {}).get("checkedAtUtc")),
            "backupArchiveName": (((details.get("backup") or {}).get("archiveName"))),
            "warnings": details.get("warnings") or [],
            "errorSource": ((details.get("statusResult") or {}).get("body") or {}).get("source"),
            "auditSummary": (((details.get("audit") or {}).get("summary"))),
        }

    def _extract_heartbeat_diagnostics(self, event):
        details = event.get("details") or {}
        post_result = details.get("postResult") or {}
        status_result = details.get("statusResult") or {}
        log_result = details.get("logResult") or {}
        diagnostics = {
            "lastRunAtUtc": event.get("loggedAt"),
            "timestampIso": details.get("timestampIso"),
            "postStatus": post_result.get("status"),
            "postOk": post_result.get("status") == 200,
            "statusSource": ((status_result.get("body") or {}).get("source")),
            "statusError": ((status_result.get("body") or {}).get("error")),
            "logOk": log_result.get("ok"),
            "logStatus": log_result.get("status"),
            "logError": ((log_result.get("body") or {}).get("error")),
            "warnings": details.get("warnings") or [],
        }
        if diagnostics["postOk"]:
            diagnostics["summary"] = "heartbeat aceito pela AIBTC"
        elif diagnostics["postStatus"]:
            diagnostics["summary"] = f"heartbeat retornou status {diagnostics['postStatus']}"
        else:
            diagnostics["summary"] = "heartbeat sem status conclusivo"
        return diagnostics

    def _build_heartbeat_status(self, summary):
        latest_success = summary.get("latestHeartbeatSuccess")
        diagnostics = summary.get("heartbeatDiagnostics")
        timestamp_iso = None
        last_success_age_minutes = None
        stale = latest_success is None
        if latest_success:
            timestamp_iso = latest_success.get("timestampIso") or latest_success.get("loggedAt")
        next_check_in_utc = None
        ready_now = True
        wait_seconds = 0
        if timestamp_iso:
            try:
                last_dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
                next_dt = last_dt + timedelta(minutes=5)
                last_success_age_minutes = round((datetime.now(timezone.utc) - last_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - last_dt) > timedelta(hours=12)
                next_check_in_utc = next_dt.isoformat()
                delta = (next_dt - datetime.now(timezone.utc)).total_seconds()
                wait_seconds = max(0, int(delta) if delta.is_integer() else int(delta) + 1)
                ready_now = wait_seconds == 0
            except Exception:
                next_check_in_utc = None
        return {
            "latestSuccess": latest_success,
            "diagnostics": diagnostics,
            "nextCheckInUtc": next_check_in_utc,
            "readyNow": ready_now,
            "waitSeconds": wait_seconds,
            "stale": stale,
            "lastSuccessAgeMinutes": last_success_age_minutes,
        }

    def _build_registry_status(self, snapshot):
        if not snapshot:
            return {
                "summary": "registry sem snapshot",
                "mainnetPublished": False,
                "checkedAtUtc": None,
                "source": "none",
                "stale": True,
                "snapshotAgeMinutes": None,
            }
        snapshot_age_minutes = None
        stale = False
        checked_at = snapshot.get("checkedAtUtc")
        if checked_at:
            try:
                checked_dt = datetime.fromisoformat(checked_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                snapshot_age_minutes = round((datetime.now(timezone.utc) - checked_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - checked_dt) > timedelta(hours=2)
            except Exception:
                stale = True
        return {
            "summary": "registry mainnet publicado" if snapshot.get("mainnetPublished") else "registry ainda indisponivel",
            "mainnetPublished": bool(snapshot.get("mainnetPublished")),
            "checkedAtUtc": snapshot.get("checkedAtUtc"),
            "statusCode": snapshot.get("statusCode"),
            "source": "snapshot",
            "stale": stale,
            "snapshotAgeMinutes": snapshot_age_minutes,
        }

    def _build_viral_claim_status(self, summary):
        latest_success = summary.get("latestViralClaimSuccess")
        latest_attempt = summary.get("latestViralClaimAttempt")
        latest = latest_success or latest_attempt
        if not latest:
            return {
                "summary": "nenhum claim viral registrado localmente",
                "latest": None,
                "ok": None,
            }
        ok = latest.get("type") == "viral_claim_success"
        if ok:
            summary_text = "claim viral aceito com sucesso"
        else:
            status = latest.get("postStatus")
            summary_text = f"claim viral retornou status {status}" if status else "claim viral sem status conclusivo"
        return {
            "summary": summary_text,
            "latest": latest,
            "ok": ok,
        }

    def _build_report_status(self, summary, report):
        latest_export = summary.get("latestOpsReportExport")
        stale = latest_export is None
        latest_export_age_minutes = None
        latest_export_logged_at = latest_export.get("loggedAt") if latest_export else None
        if latest_export_logged_at:
            try:
                export_dt = datetime.fromisoformat(latest_export_logged_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                latest_export_age_minutes = round((datetime.now(timezone.utc) - export_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - export_dt) > timedelta(hours=24)
            except Exception:
                stale = True
        if not report:
            return {
                "available": False,
                "summary": "nenhum relatorio local disponivel",
                "generatedAtUtc": None,
                "lastHeartbeatOkUtc": None,
                "latestExport": latest_export,
                "stale": True,
                "latestExportAgeMinutes": latest_export_age_minutes,
            }
        heartbeat = report.get("heartbeat") or {}
        latest_success = heartbeat.get("latestSuccess") or {}
        generated_at = report.get("checkedAtUtc")
        last_heartbeat = latest_success.get("timestampIso") or latest_success.get("loggedAt")
        registry = report.get("registry") or {}
        return {
            "available": True,
            "summary": f"relatorio local disponivel; registry: {registry.get('summary', 'desconhecido')}",
            "generatedAtUtc": generated_at,
            "lastHeartbeatOkUtc": last_heartbeat,
            "latestExport": latest_export,
            "stale": stale,
            "latestExportAgeMinutes": latest_export_age_minutes,
        }

    def _build_maintenance_status(self, summary):
        latest_repair = summary.get("latestLocalStateRepair")
        latest_prune = summary.get("latestLocalStatePrune")
        latest_restore = summary.get("latestLocalStateRestore")
        latest = latest_restore or latest_prune or latest_repair
        if not latest:
            return {
                "summary": "nenhuma manutencao local registrada",
                "latest": None,
                "latestRepair": None,
                "latestPrune": None,
                "latestRestore": None,
            }
        latest_type = latest.get("type")
        latest_status = latest.get("resultStatus")
        if latest_type == "local_state_prune":
            action = "retencao local"
        elif latest_type == "local_state_restore":
            action = "restauracao local"
        else:
            action = "reconstrucao local"
        status_text = "ok" if latest_status == 200 else f"status {latest_status}" if latest_status else "sem status"
        return {
            "summary": f"{action} executada com {status_text}",
            "latest": latest,
            "latestRepair": latest_repair,
            "latestPrune": latest_prune,
            "latestRestore": latest_restore,
        }

    def _build_maintenance_cycle_status(self, summary):
        latest = summary.get("latestMaintenanceCycleRun")
        if not latest:
            return {
                "summary": "nenhum ciclo de manutencao registrado",
                "latest": None,
                "stale": True,
                "latestAgeMinutes": None,
            }
        latest_logged_at = latest.get("loggedAt")
        stale = True
        latest_age_minutes = None
        if latest_logged_at:
            try:
                latest_dt = datetime.fromisoformat(latest_logged_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                latest_age_minutes = round((datetime.now(timezone.utc) - latest_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - latest_dt) > timedelta(days=2)
            except Exception:
                stale = True
        return {
            "summary": "ciclo de manutencao executado",
            "latest": latest,
            "stale": stale,
            "latestAgeMinutes": latest_age_minutes,
        }

    def _build_backup_status(self, summary):
        latest = summary.get("latestLocalStateBackup")
        backup_meta = self._load_latest_backup_meta()
        if not latest and backup_meta:
            latest = {
                "loggedAt": backup_meta.get("checkedAtUtc"),
                "type": "local_state_backup",
                "backupArchiveName": backup_meta.get("archiveName"),
            }
        if not latest:
            return {
                "summary": "nenhum backup local registrado",
                "latest": None,
                "stale": True,
                "latestAgeMinutes": None,
            }
        latest_logged_at = latest.get("loggedAt")
        stale = True
        latest_age_minutes = None
        if latest_logged_at:
            try:
                latest_dt = datetime.fromisoformat(latest_logged_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                latest_age_minutes = round((datetime.now(timezone.utc) - latest_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - latest_dt) > timedelta(days=3)
            except Exception:
                stale = True
        archive_name = latest.get("backupArchiveName")
        summary_text = "backup local disponivel"
        if archive_name:
            summary_text = f"backup local disponivel ({archive_name})"
        return {
            "summary": summary_text,
            "latest": latest,
            "stale": stale,
            "latestAgeMinutes": latest_age_minutes,
            "metadata": backup_meta,
        }

    def _build_daily_check_status(self, summary):
        latest = summary.get("latestDailyCheckRun")
        if not latest:
            return {
                "summary": "nenhum daily check registrado",
                "latest": None,
                "stale": True,
                "latestAgeMinutes": None,
            }
        latest_status = latest.get("resultStatus")
        latest_logged_at = latest.get("loggedAt")
        stale = True
        latest_age_minutes = None
        if latest_logged_at:
            try:
                latest_dt = datetime.fromisoformat(latest_logged_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                latest_age_minutes = round((datetime.now(timezone.utc) - latest_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - latest_dt) > timedelta(hours=24)
            except Exception:
                stale = True
        status_text = "ok" if latest_status == 200 else f"status {latest_status}" if latest_status else "sem status"
        return {
            "summary": f"daily check executado com {status_text}",
            "latest": latest,
            "stale": stale,
            "latestAgeMinutes": latest_age_minutes,
        }

    def _build_integrity_audit_status(self, summary):
        latest = summary.get("latestIntegrityAuditRun")
        latest_audit = self._load_latest_integrity_audit()
        if not latest and latest_audit:
            latest = {
                "loggedAt": latest_audit.get("checkedAtUtc"),
                "type": "integrity_audit_run",
                "auditSummary": latest_audit.get("summary"),
            }
        if not latest:
            return {
                "summary": "nenhuma auditoria de integridade registrada",
                "latest": None,
                "ok": None,
                "findings": [],
                "stale": True,
                "latestAgeMinutes": None,
            }
        latest_logged_at = latest.get("loggedAt")
        latest_age_minutes = None
        stale = True
        if latest_logged_at:
            try:
                latest_dt = datetime.fromisoformat(latest_logged_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                latest_age_minutes = round((datetime.now(timezone.utc) - latest_dt).total_seconds() / 60, 1)
                stale = (datetime.now(timezone.utc) - latest_dt) > timedelta(hours=24)
            except Exception:
                stale = True
        findings = (latest_audit or {}).get("findings") or []
        ok = (latest_audit or {}).get("ok")
        if ok is True:
            summary_text = "auditoria de integridade sem divergencias"
        elif ok is False:
            summary_text = (latest_audit or {}).get("summary") or "auditoria de integridade encontrou divergencias"
        else:
            summary_text = latest.get("auditSummary") or "auditoria de integridade sem status conclusivo"
        return {
            "summary": summary_text,
            "latest": latest,
            "ok": ok,
            "findings": findings,
            "stale": stale,
            "latestAgeMinutes": latest_age_minutes,
        }

    def _load_position_monitor_config(self):
        if not POSITION_MONITOR_CONFIG_PATH.exists():
            return None
        try:
            return json.loads(POSITION_MONITOR_CONFIG_PATH.read_text(encoding="utf-8-sig"))
        except Exception:
            return None

    def _load_position_policy(self, config):
        policy = (config or {}).get("policy") or {}
        return {
            "objective": policy.get("objective"),
            "executionMode": policy.get("executionMode") or "monitoramento_com_recomendacao",
            "reviewCadenceHours": int(policy.get("reviewCadenceHours") or 24),
            "confirmationMaxAgeHours": int(policy.get("confirmationMaxAgeHours") or 24),
            "minExpectedGainToFeeRatio": float(policy.get("minExpectedGainToFeeRatio") or 2),
            "allowLeverage": bool(policy.get("allowLeverage")),
            "allowLp": bool(policy.get("allowLp")),
            "allowBorrow": bool(policy.get("allowBorrow")),
            "approvalRequired": bool(policy.get("approvalRequired", True)),
            "allowedProtocols": policy.get("allowedProtocols") or [],
        }

    def _fetch_stacks_address_balances(self, stx_address):
        if not stx_address:
            return {
                "ok": False,
                "summary": "endereco STX ausente no monitor de posicao",
                "source": "hiro",
            }

        url = f"{HIRO_MAINNET_API}/extended/v1/address/{stx_address}/balances"
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            return {
                "ok": False,
                "summary": f"falha ao consultar saldos publicos: {exc}",
                "source": "hiro",
                "stxAddress": stx_address,
            }

        stx = payload.get("stx") or {}
        fungible_tokens = payload.get("fungible_tokens") or {}
        sbtc = fungible_tokens.get(SBTC_TOKEN_KEY) or {}
        return {
            "ok": True,
            "summary": "saldos publicos consultados com sucesso",
            "source": "hiro",
            "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
            "stxAddress": stx_address,
            "stxMicroStx": int(stx.get("balance") or 0),
            "sbtcSats": int(sbtc.get("balance") or 0),
        }

    def _build_position_monitor_status(self):
        config = self._load_position_monitor_config()
        if not config:
            return {
                "enabled": False,
                "summary": "monitor de posicao sem configuracao local",
                "mode": "disabled",
                "config": None,
                "liveBalances": None,
                "positionBaseline": None,
                "positionConfirmation": None,
            }

        stx_address = config.get("stxAddress")
        live_balances = self._fetch_stacks_address_balances(stx_address)
        baseline = config.get("baseline") or {}
        confirmation = config.get("lastConfirmedPosition") or {}
        policy = self._load_position_policy(config)
        active_protocol = (
            confirmation.get("activeProtocol")
            or baseline.get("activeProtocol")
            or "Zest"
        )

        confirmation_checked_at = confirmation.get("checkedAtUtc")
        confirmation_age_minutes = None
        confirmation_stale = True
        if confirmation_checked_at:
            try:
                confirmation_dt = datetime.fromisoformat(confirmation_checked_at.replace("Z", "+00:00")).astimezone(timezone.utc)
                confirmation_age_minutes = round((datetime.now(timezone.utc) - confirmation_dt).total_seconds() / 60, 1)
                confirmation_stale = (datetime.now(timezone.utc) - confirmation_dt) > timedelta(hours=policy["confirmationMaxAgeHours"])
            except Exception:
                confirmation_stale = True

        expected_position_active = bool(config.get("expectedPositionActive"))
        baseline_shares = int(baseline.get("suppliedShares") or 0)
        confirmed_shares = int(confirmation.get("suppliedShares") or 0)
        expected_borrowed = int(config.get("expectedBorrowed") or 0)
        confirmed_borrowed = int(confirmation.get("borrowed") or 0)

        summary_parts = []
        if expected_position_active:
            summary_parts.append(f"baseline ativo em {active_protocol}")
        if policy.get("executionMode"):
            summary_parts.append(f"politica em {policy['executionMode']}")
        if live_balances.get("ok"):
            summary_parts.append(
                f"saldo livre: {live_balances.get('sbtcSats', 0)} sats sBTC e {live_balances.get('stxMicroStx', 0)} microSTX"
            )
        else:
            summary_parts.append(live_balances.get("summary") or "saldos publicos indisponiveis")
        if confirmation_checked_at:
            freshness = "antiga" if confirmation_stale else "ok"
            summary_parts.append(f"confirmacao de posicao em {active_protocol} {freshness}")

        return {
            "enabled": True,
            "summary": "; ".join(summary_parts),
            "mode": "live_public_balances_plus_confirmed_position",
            "expectedPositionActive": expected_position_active,
            "expectedBorrowed": expected_borrowed,
            "activeProtocol": active_protocol,
            "policy": policy,
            "config": config,
            "liveBalances": live_balances,
            "positionBaseline": {
                "activeProtocol": baseline.get("activeProtocol"),
                "suppliedShares": baseline_shares,
                "sbtcReserveMinSats": int(config.get("sbtcReserveMinSats") or 0),
                "stxReserveMinMicroStx": int(config.get("stxReserveMinMicroStx") or 0),
            },
            "positionConfirmation": {
                "checkedAtUtc": confirmation_checked_at,
                "ageMinutes": confirmation_age_minutes,
                "stale": confirmation_stale,
                "activeProtocol": confirmation.get("activeProtocol"),
                "suppliedShares": confirmed_shares,
                "borrowed": confirmed_borrowed,
                "healthFactor": confirmation.get("healthFactor"),
            },
        }

    def _build_operational_alerts(self, heartbeat_status, registry_status, report_status, backup_status, daily_check_status, integrity_audit_status, position_status):
        alerts = []
        if heartbeat_status.get("latestSuccess") is None:
            alerts.append({
                "level": "warn",
                "code": "heartbeat_missing",
                "summary": "nenhum heartbeat local registrado",
            })
        elif heartbeat_status.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "heartbeat_stale",
                "summary": "ultimo heartbeat local esta antigo",
            })
        if registry_status.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "registry_snapshot_stale",
                "summary": "snapshot do registry esta antigo",
            })
        if not report_status.get("available"):
            alerts.append({
                "level": "warn",
                "code": "report_missing",
                "summary": "nenhum relatorio local disponivel",
            })
        elif report_status.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "report_stale",
                "summary": "ultimo relatorio local esta antigo",
            })
        if backup_status.get("latest") is None:
            alerts.append({
                "level": "warn",
                "code": "backup_missing",
                "summary": "nenhum backup local registrado",
            })
        elif backup_status.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "backup_stale",
                "summary": "ultimo backup local esta antigo",
            })
        if daily_check_status.get("latest") is None:
            alerts.append({
                "level": "warn",
                "code": "daily_check_missing",
                "summary": "nenhum daily check registrado",
            })
        elif daily_check_status.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "daily_check_stale",
                "summary": "ultimo daily check esta antigo",
            })
        if integrity_audit_status.get("latest") is None:
            alerts.append({
                "level": "warn",
                "code": "integrity_audit_missing",
                "summary": "nenhuma auditoria de integridade registrada",
            })
        elif integrity_audit_status.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "integrity_audit_stale",
                "summary": "ultima auditoria de integridade esta antiga",
            })
        elif integrity_audit_status.get("ok") is False:
            alerts.append({
                "level": "warn",
                "code": "integrity_audit_failed",
                "summary": integrity_audit_status.get("summary") or "auditoria de integridade encontrou divergencias",
            })
        alerts.extend(self._build_position_alerts(position_status))
        return alerts

    def _build_position_alerts(self, position_status):
        if not position_status or not position_status.get("enabled"):
            return []

        alerts = []
        live_balances = position_status.get("liveBalances") or {}
        baseline = position_status.get("positionBaseline") or {}
        confirmation = position_status.get("positionConfirmation") or {}
        protocol_label = (
            confirmation.get("activeProtocol")
            or baseline.get("activeProtocol")
            or position_status.get("activeProtocol")
            or "Zest"
        )

        if confirmation.get("checkedAtUtc") and confirmation.get("stale"):
            alerts.append({
                "level": "warn",
                "code": "position_confirmation_stale",
                "summary": f"confirmacao local da posicao em {protocol_label} esta antiga; revalidar shares e borrowed no chat antes de decidir ajuste",
            })

        if position_status.get("expectedPositionActive") and confirmation.get("suppliedShares", 0) == 0:
            alerts.append({
                "level": "warn",
                "code": "zest_position_unexpected_zero",
                "summary": f"baseline espera posicao ativa em {protocol_label}, mas a ultima confirmacao local esta zerada",
            })
        elif confirmation.get("suppliedShares", 0) < baseline.get("suppliedShares", 0):
            alerts.append({
                "level": "warn",
                "code": "zest_position_below_baseline",
                "summary": f"ultima confirmacao local em {protocol_label} mostra suppliedShares abaixo do baseline esperado",
            })

        if confirmation.get("borrowed", 0) != position_status.get("expectedBorrowed", 0):
            alerts.append({
                "level": "warn",
                "code": "zest_unexpected_borrowed",
                "summary": f"ultima confirmacao local em {protocol_label} mostra borrowed diferente do esperado para a estrategia conservadora",
            })

        if live_balances.get("ok"):
            if live_balances.get("sbtcSats", 0) < baseline.get("sbtcReserveMinSats", 0):
                alerts.append({
                    "level": "warn",
                    "code": "sbtc_reserve_below_min",
                    "summary": "saldo livre de sBTC ficou abaixo da reserva minima configurada",
                })
            if live_balances.get("stxMicroStx", 0) < baseline.get("stxReserveMinMicroStx", 0):
                alerts.append({
                    "level": "warn",
                    "code": "stx_gas_below_min",
                    "summary": "saldo de STX ficou abaixo da reserva minima de gas",
                })
        else:
            alerts.append({
                "level": "warn",
                "code": "position_live_balances_unavailable",
                "summary": live_balances.get("summary") or "nao foi possivel consultar saldos publicos da wallet",
            })

        return alerts

    def _build_recommended_actions(self, heartbeat_status, registry_status, report_status, backup_status, daily_check_status, alerts, position_status):
        actions = []
        alert_codes = {item.get("code") for item in (alerts or [])}

        if "heartbeat_missing" in alert_codes:
            actions.append({
                "code": "run_first_heartbeat",
                "summary": "executar um heartbeat real para iniciar a trilha local de operacao",
                "priority": "high",
            })
        elif "heartbeat_stale" in alert_codes:
            actions.append({
                "code": "refresh_heartbeat",
                "summary": "executar um novo heartbeat para atualizar o estado local do agente",
                "priority": "high",
            })
        elif heartbeat_status.get("readyNow"):
            actions.append({
                "code": "heartbeat_ready",
                "summary": "heartbeat liberado agora; pode executar novo check-in quando fizer sentido operacionalmente",
                "priority": "medium",
            })

        if "registry_snapshot_stale" in alert_codes:
            actions.append({
                "code": "refresh_registry_snapshot",
                "summary": "atualizar o snapshot local do registry para evitar leitura antiga",
                "priority": "high",
            })

        maintenance_related_codes = {
            "report_missing",
            "report_stale",
            "backup_missing",
            "backup_stale",
            "daily_check_missing",
            "daily_check_stale",
            "integrity_audit_missing",
            "integrity_audit_stale",
            "integrity_audit_failed",
        }
        if alert_codes.intersection(maintenance_related_codes):
            actions.append({
                "code": "run_maintenance_cycle",
                "summary": "rodar o ciclo completo de manutencao local para atualizar backup, relatorio, daily check e auditoria",
                "priority": "high",
            })

        if "report_missing" in alert_codes or "report_stale" in alert_codes:
            actions.append({
                "code": "export_ops_report",
                "summary": "exportar um novo relatorio operacional local",
                "priority": "medium",
            })

        if "backup_missing" in alert_codes or "backup_stale" in alert_codes:
            actions.append({
                "code": "backup_local_state",
                "summary": "gerar um novo backup local do estado operacional",
                "priority": "medium",
            })

        if "daily_check_missing" in alert_codes or "daily_check_stale" in alert_codes:
            actions.append({
                "code": "run_daily_check",
                "summary": "rodar o daily check local para atualizar estado, snapshot e relatorio",
                "priority": "medium",
            })
        if (
            "integrity_audit_missing" in alert_codes
            or "integrity_audit_stale" in alert_codes
            or "integrity_audit_failed" in alert_codes
        ):
            actions.append({
                "code": "run_integrity_audit",
                "summary": "rodar a auditoria de integridade local para verificar coerencia entre helper, log, relatorio e backup",
                "priority": "medium",
            })

        if "position_confirmation_stale" in alert_codes:
            protocol_label = (
                (position_status.get("positionConfirmation") or {}).get("activeProtocol")
                or (position_status.get("positionBaseline") or {}).get("activeProtocol")
                or position_status.get("activeProtocol")
                or "protocolo ativo"
            )
            actions.append({
                "code": "refresh_position_confirmation",
                "summary": f"revalidar no chat a posicao em {protocol_label} para atualizar shares, borrowed, health factor e aderencia a politica local",
                "priority": "medium",
            })

        if "zest_position_unexpected_zero" in alert_codes or "zest_position_below_baseline" in alert_codes:
            protocol_label = (
                (position_status.get("positionConfirmation") or {}).get("activeProtocol")
                or (position_status.get("positionBaseline") or {}).get("activeProtocol")
                or position_status.get("activeProtocol")
                or "protocolo ativo"
            )
            actions.append({
                "code": "review_zest_position",
                "summary": f"revisar a posicao em {protocol_label} antes de qualquer novo aporte ou saque",
                "priority": "high",
            })

        if "zest_unexpected_borrowed" in alert_codes:
            actions.append({
                "code": "review_unexpected_debt",
                "summary": "investigar imediatamente o borrowed da posicao antes de manter a estrategia",
                "priority": "high",
            })

        if "sbtc_reserve_below_min" in alert_codes or "stx_gas_below_min" in alert_codes:
            actions.append({
                "code": "restore_wallet_reserves",
                "summary": "recompor a reserva liquida da wallet antes de depender de nova operacao",
                "priority": "medium",
            })

        if not actions:
            actions.append({
                "code": "maintain_operations",
                "summary": "seguir com operacao normal: monitorar heartbeat, logs locais e snapshot do registry",
                "priority": "normal",
            })

        return actions

    def _update_ops_summary(self, summary, event):
        event_summary = self._summarize_event(event)
        summary["updatedAtUtc"] = event.get("loggedAt")
        summary["latestEvent"] = event_summary

        event_type = event.get("type")
        if event_type == "heartbeat_success":
            summary["latestHeartbeatSuccess"] = event_summary
            summary["heartbeatDiagnostics"] = self._extract_heartbeat_diagnostics(event)
        elif event_type == "heartbeat_attempt":
            summary["latestHeartbeatAttempt"] = event_summary
            summary["heartbeatDiagnostics"] = self._extract_heartbeat_diagnostics(event)
        elif event_type == "viral_claim_success":
            summary["latestViralClaimSuccess"] = event_summary
        elif event_type == "viral_claim_attempt":
            summary["latestViralClaimAttempt"] = event_summary
        elif event_type == "registry_check":
            summary["latestRegistryCheck"] = event_summary
        elif event_type == "registry_state_change":
            summary["latestRegistryStateChange"] = event_summary
        elif event_type == "ops_report_export":
            summary["latestOpsReportExport"] = event_summary
        elif event_type == "local_state_repair":
            summary["latestLocalStateRepair"] = event_summary
        elif event_type == "local_state_prune":
            summary["latestLocalStatePrune"] = event_summary
        elif event_type == "local_state_backup":
            summary["latestLocalStateBackup"] = event_summary
        elif event_type == "local_state_restore":
            summary["latestLocalStateRestore"] = event_summary
        elif event_type == "daily_check_run":
            summary["latestDailyCheckRun"] = event_summary
        elif event_type == "integrity_audit_run":
            summary["latestIntegrityAuditRun"] = event_summary
        elif event_type == "maintenance_cycle_run":
            summary["latestMaintenanceCycleRun"] = event_summary
        recent_events = summary.get("recentEvents") or []
        recent_events.append(event_summary)
        summary["recentEvents"] = recent_events[-10:]
        return summary

    def _rebuild_ops_summary_from_log(self):
        summary = self._ensure_summary_shape({
            "updatedAtUtc": None,
            "latestEvent": None,
            "latestHeartbeatSuccess": None,
            "latestHeartbeatAttempt": None,
            "latestViralClaimSuccess": None,
            "latestViralClaimAttempt": None,
            "latestRegistryCheck": None,
            "latestRegistryStateChange": None,
            "latestOpsReportExport": None,
            "latestLocalStateRepair": None,
            "latestLocalStatePrune": None,
            "latestLocalStateBackup": None,
            "latestLocalStateRestore": None,
            "latestDailyCheckRun": None,
            "latestIntegrityAuditRun": None,
            "latestMaintenanceCycleRun": None,
            "heartbeatDiagnostics": None,
            "recentEvents": [],
        })
        if not OPS_LOG_PATH.exists():
            return summary
        try:
            with OPS_LOG_PATH.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    summary = self._update_ops_summary(summary, item)
        except Exception:
            return summary
        return summary

    def _append_event_record(self, payload):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        record = {
            "loggedAt": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        with OPS_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=True) + "\n")
        summary = self._load_ops_summary()
        summary = self._update_ops_summary(summary, record)
        self._save_ops_summary(summary)
        return record

    def _safe_parse_json(self, body: str):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"raw": body}

    def _send_json(self, status: int, payload) -> None:
        encoded = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    port = int(os.environ.get("AIBTC_HELPER_PORT", "8765"))
    if len(sys.argv) >= 3 and sys.argv[1] == "--port":
        port = int(sys.argv[2])
    server = ThreadingHTTPServer(("127.0.0.1", port), RegisterHelperHandler)
    print(f"Helper server listening on http://127.0.0.1:{port}/leather-register-helper.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
