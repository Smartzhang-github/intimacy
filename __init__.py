"""私密记录集成 v4.0 - Home Assistant 2026.6.1
"""
import logging
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.components import frontend
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from aiohttp import web

DOMAIN = "intimacy"
STORAGE_KEY = "intimacy_data"
STORAGE_VERSION = 1
PLATFORMS = ["sensor"]
VERSION = "4.2.0"

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass, config):
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {
        "records": [],
        "periods": [],
        "settings": {
            "cycle_length": 28,
            "period_length": 5,
            "safe_period_days": 7,
            "ovulation_buffer_days": 5,
        },
    }

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "store": store,
        "data": data,
        "entry": entry,
        "coordinator": None,
    }

    # 注册 HTTP 路由（无认证）
    hass.http.register_view(IntimacyView)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await _register_panel(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, DOMAIN)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok


# ── helpers ──
def _entry_id(hass):
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0].entry_id if entries else None


def _get_data(hass):
    eid = _entry_id(hass)
    return hass.data[DOMAIN][eid]["data"] if eid else None


async def _save(hass):
    eid = _entry_id(hass)
    if not eid:
        return
    await hass.data[DOMAIN][eid]["store"].async_save(
        hass.data[DOMAIN][eid]["data"]
    )
    c = hass.data[DOMAIN][eid].get("coordinator")
    if c:
        hass.async_create_task(c.async_request_refresh())


# ── HA View (绕过 CSRF 认证) ──
class IntimacyView(HomeAssistantView):
    url = "/intimacy_data"
    name = "intimacy_data"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        return await _handle_request(request)

    async def post(self, request: web.Request) -> web.Response:
        return await _handle_request(request)


# ── HTTP handler ──
async def _handle_request(request: web.Request) -> web.Response:
    hass = request.app["hass"]
    _LOGGER.info("[Intimacy] %s %s", request.method, request.path)
    data = _get_data(hass)
    if not data:
        _LOGGER.error("[Intimacy] No data entry found")
        return web.json_response({"error": "no entry"}, status=400)

    if request.method == "GET":
        action = request.query.get("action", "")
        month_filter = request.query.get("month", "")
        try:
            if action == "get_stats":
                return web.json_response(_calc_stats(data))
            if action == "get_records":
                records = data.get("records", [])
                if month_filter:
                    records = [
                        r
                        for r in records
                        if (r.get("date", "") or "")[:7] == month_filter
                    ]
                return web.json_response({"records": records})
            if action == "get_periods":
                return web.json_response({"periods": data.get("periods", [])})
            if action == "get_settings":
                return web.json_response({"settings": data.get("settings", {})})
            return web.json_response({"error": f"unknown: {action}"}, status=400)
        except Exception as e:
            _LOGGER.exception("GET %s", action)
            return web.json_response({"error": str(e)}, status=500)

    # POST
    try:
        body = await request.json()
    except Exception:
        body = {}

    action = body.get("action", "")
    try:
        if action == "add_record":
            rec = dict(body.get("record", {}))
            rec.setdefault("id", datetime.now().strftime("%Y%m%d%H%M%S%f"))
            rec.setdefault("created_at", datetime.now().isoformat())
            # 确保必要字段有默认值
            rec["date"] = rec.get("date") or datetime.now().strftime("%Y-%m-%d")
            rec["category"] = rec.get("category") or "sex"
            rec["pleasure"] = max(1, min(10, int(rec.get("pleasure", 5) or 5)))
            rec["duration"] = max(1, int(rec.get("duration", 30) or 30))
            rec["cooperation"] = max(1, min(5, int(rec.get("cooperation", 3) or 3)))
            data["records"].append(rec)
            await _save(hass)
            return web.json_response({"success": True, "record": rec})

        if action == "delete_record":
            rid = body.get("record_id")
            data["records"] = [
                r for r in data["records"] if r.get("id") != rid
            ]
            await _save(hass)
            return web.json_response({"success": True})

        if action == "add_period":
            p = {
                "id": datetime.now().strftime("%Y%m%d%H%M%S%f"),
                "start_date": body.get("start_date"),
                "end_date": body.get("end_date") or None,
                "notes": body.get("notes", ""),
                "created_at": datetime.now().isoformat(),
            }
            data["periods"].append(p)
            await _save(hass)
            return web.json_response({"success": True, "period": p})

        if action == "delete_period":
            pid = body.get("period_id")
            data["periods"] = [
                p for p in data["periods"] if p.get("id") != pid
            ]
            await _save(hass)
            return web.json_response({"success": True})

        if action == "update_settings":
            new_settings = body.get("settings", {})
            data["settings"].update(new_settings)
            await _save(hass)
            return web.json_response({"success": True})

        if action == "clear_all_data":
            confirm = body.get("confirm", "")
            if confirm != "YES_DELETE_ALL":
                return web.json_response({"error": "confirmation required"}, status=400)
            data["records"] = []
            data["periods"] = []
            await _save(hass)
            return web.json_response({"success": True})


        if action == "import_records":
            new_records = body.get("records", [])
            existing_keys = set()
            for r in data["records"]:
                key = (r.get("date", ""), r.get("time", ""))
                existing_keys.add(key)
            added = 0
            for rec in new_records:
                key = (rec.get("date", ""), rec.get("time", ""))
                if key not in existing_keys:
                    data["records"].append(rec)
                    existing_keys.add(key)
                    added += 1
            await _save(hass)
            return web.json_response({'ok': True, 'added': added, 'skipped': len(new_records) - added})

        if action == "import_periods":
            new_periods = body.get("periods", [])
            existing_keys = set()
            for p in data["periods"]:
                key = (p.get("start_date", ""), p.get("end_date", ""))
                existing_keys.add(key)
            added = 0
            for per in new_periods:
                key = (per.get("start_date", ""), per.get("end_date", ""))
                if key not in existing_keys:
                    data["periods"].append(per)
                    existing_keys.add(key)
                    added += 1
            await _save(hass)
            return web.json_response({'ok': True, 'added': added, 'skipped': len(new_periods) - added})

        return web.json_response({"error": f"unknown: {action}"}, status=400)
    except Exception as e:
        _LOGGER.exception("POST %s", action)
        return web.json_response({"error": str(e)}, status=500)


def _calc_stats(data):
    records = data.get("records", [])
    settings = data.get("settings", {})
    now = datetime.now()
    mon = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    wk = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    def p(s):
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d")
        except:
            return datetime.min

    total = len(records)
    mcnt = sum(1 for r in records if p(r.get("date", "")) >= mon)
    wcnt = sum(1 for r in records if p(r.get("date", "")) >= wk)
    ycnt = sum(1 for r in records if p(r.get("date", "")) >= year_start)
    avg_pleasure = (
        sum(r.get("pleasure", 0) for r in records) / total if total else 0
    )
    avg_duration = (
        sum(r.get("duration", 0) for r in records) / total if total else 0
    )
    condom_count = sum(1 for r in records if r.get("condom"))
    toy_count = sum(1 for r in records if r.get("sex_toy"))
    sex_count = sum(1 for r in records if (r.get("category") or "sex") == "sex")
    mast_count = sum(1 for r in records if r.get("category") == "masturbation")

    # 姿势分布（支持多选）
    positions = {}
    for r in records:
        pos_list = r.get("position", "")
        if pos_list:
            for p in pos_list.split('、'):
                p = p.strip()
                if p:
                    positions[p] = positions.get(p, 0) + 1

    # 做爱方式分布
    methods = {}
    for r in records:
        m_list = r.get("method", "")
        if m_list:
            for m in m_list.split('、'):
                m = m.strip()
                if m:
                    methods[m] = methods.get(m, 0) + 1

    # 射精位置分布
    ejaculations = {}
    for r in records:
        e_list = r.get("ejaculation", "")
        if e_list:
            for e in e_list.split('、'):
                e = e.strip()
                if e:
                    ejaculations[e] = ejaculations.get(e, 0) + 1

    # 心情分布
    moods = {}
    for r in records:
        m = r.get("mood", "")
        if m:
            moods[m] = moods.get(m, 0) + 1

    # 地点分布
    locations = {}
    for r in records:
        loc = r.get("location", "")
        if loc:
            locations[loc] = locations.get(loc, 0) + 1

    # 最高愉悦日
    best = (
        max(records, key=lambda r: r.get("pleasure", 0))
        if records
        else None
    )

    # 安全期状态
    is_safe = False
    if records:
        today_str = now.strftime("%Y-%m-%d")
        is_safe = _is_date_in_safe_period(today_str, data)

    # 下次经期预测
    next_period = None
    if data.get("periods"):
        last_period = max(
            data["periods"], key=lambda p: p.get("start_date", "")
        )
        cycle_len = settings.get("cycle_length", 28)
        last_start = datetime.strptime(last_period["start_date"][:10], "%Y-%m-%d")
        next_period = (last_start + timedelta(days=cycle_len)).strftime("%Y-%m-%d")

    # 每月统计（用于年热力图）
    monthly = {}
    for r in records:
        key = (r.get("date", "") or "")[:7]
        monthly[key] = monthly.get(key, 0) + 1

    return {
        "total_count": total,
        "month_count": mcnt,
        "week_count": wcnt,
        "year_count": ycnt,
        "avg_pleasure": round(avg_pleasure, 1),
        "avg_duration": round(avg_duration, 1),
        "condom_rate": round(condom_count / total * 100, 1) if total else 0,
        "toy_rate": round(toy_count / total * 100, 1) if total else 0,
        "sex_count": sex_count,
        "mast_count": mast_count,
        "positions": positions,
        "best_record": {
            "date": best.get("date") if best else None,
            "pleasure": best.get("pleasure") if best else None,
        }
        if best
        else None,
        "is_safe_period": is_safe,
        "next_period": next_period,
        "monthly": monthly,
        "methods": methods,
        "ejaculations": ejaculations,
        "moods": moods,
        "locations": locations,
    }


def _is_date_in_safe_period(date_str, data):
    """判断指定日期是否在安全期"""
    periods = data.get("periods", [])
    settings = data.get("settings", {})
    if not periods:
        return False
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d")
    except:
        return False

    cycle_len = settings.get("cycle_length", 28)
    safe_days = settings.get("safe_period_days", 7)
    period_days = settings.get("period_length", 5)

    last_period = max(periods, key=lambda p: p.get("start_date", ""))
    try:
        last_start = datetime.strptime(last_period["start_date"][:10], "%Y-%m-%d")
    except:
        return False

    days_since = (d - last_start).days
    if days_since < 0:
        return False

    cycle_day = days_since % cycle_len

    # 经期内（开始几天）
    if cycle_day < period_days:
        return False

    # 经期结束后到安全期开始前 = 易孕期
    fertile_start = period_days
    fertile_end = cycle_len - safe_days
    if fertile_start <= cycle_day < fertile_end:
        return False

    # 安全期（经期结束后safe_days天 + 周期最后safe_days天）
    return cycle_day >= fertile_end or cycle_day < period_days


# ── panel ──
async def _register_panel(hass: HomeAssistant):
    www_path = hass.config.path("custom_components/intimacy/www")

    await hass.http.async_register_static_paths(
        [StaticPathConfig(url_path="/intimacy_static", path=www_path, cache_headers=False)]
    )

    frontend.async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title="亲密空间",
        sidebar_icon="mdi:heart",
        frontend_url_path=DOMAIN,
        config={"url": f"/intimacy_static/index.html?v={VERSION}"},
        require_admin=False,
    )
