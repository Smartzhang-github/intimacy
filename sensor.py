"""私密记录 sensor 实体 - v5.0 全字段实体化"""
import logging
from datetime import datetime, timedelta
from collections import Counter

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.storage import Store
from homeassistant.helpers.entity import Entity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.components.sensor import SensorEntity

DOMAIN = "intimacy"
_LOGGER = logging.getLogger(__name__)

# ── 文本映射 ──
_MOOD_TEXT = {
    "happy": "😊开心", "romantic": "💕浪漫", "passionate": "🔥激情",
    "wild": "😈狂野", "tender": "🥰温柔", "tired": "😴疲惫",
    "calm": "😐平淡", "frustrated": "😞失落", "curious": "🤔好奇",
    "sober": "🧠清醒", "expect": "🤩期待", "satisfied": "😌满足",
    "surprised": "😲惊喜", "regret": "😔遗憾", "wanting": "😳意犹未尽",
}
_LIBIDO_TEXT = {1: "😴很低", 2: "😐一般", 3: "😊正常", 4: "😳强烈", 5: "🤯爆炸"}
_ALCOHOL_TEXT = {"none": "🚫无", "light": "🍺少量", "medium": "🍷中量", "drunk": "🥴醉酒"}
_CONTRACEPTION_TEXT = {
    "condom": "🛡️安全套", "none": "❌无保护", "pill": "💊短效避孕药",
    "iud": "🔵宫内节育器", "withdrawal": "💧体外射精",
    "safe": "📅安全期", "planb": "⏰紧急避孕",
}
_CUMSHOT_TEXT = {
    "none": "—未发生", "creampie": "💛内射", "cumshot": "🌊颜射",
    "oral": "👅口内", "anal": "🔴肛内",
}
_PHYSICAL_TEXT = {
    "normal": "💪正常", "tired": "😴略疲惫", "sick": "🤒身体不适",
    "drunk": "🥴微醺", "horny": "🔥性致盎然", "relaxed": "😌放松愉悦",
}
_SLEEP_TEXT = {
    "bad": "😫很差", "poor": "🙁较差", "normal": "😐一般",
    "good": "😊良好", "great": "😴非常好",
}
_CATEGORY_TEXT = {
    "sex": "💑 做爱", "masturbation": "🖐️ 自慰",
}
_COOPERATION_TEXT = {
    1: "😒 抗拒", 2: "😐 勉强", 3: "🙂 配合", 4: "😊 积极", 5: "🤩 非常投入",
}
_PHASE_ICON = {
    "经期": "mdi:water", "易孕期": "mdi:alert-circle", "安全期": "mdi:shield-check",
}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities):
    store = Store(hass, 1, "intimacy_data")

    async def async_update():
        data = await store.async_load()
        if not data:
            return {
                "records": [], "periods": [], "settings": {
                    "cycle_length": 28, "period_length": 5, "safe_period_days": 7,
                },
            }
        return data

    coordinator = DataUpdateCoordinator(
        hass, _LOGGER,
        name=DOMAIN,
        update_method=async_update,
        update_interval=timedelta(seconds=30),
    )
    await coordinator.async_refresh()

    # ── 统计类 ──
    async_add_entities([
        StatisticsSensor(coordinator, entry),
        PleasureTrendSensor(coordinator, entry),
        FrequencyTrendSensor(coordinator, entry),
    ])

    # ── 周期类 ──
    async_add_entities([
        PeriodNextSensor(coordinator, entry),
        PeriodPhaseSensor(coordinator, entry),
        PeriodDaysLeftSensor(coordinator, entry),
    ])

    # ── 上次记录详情（每字段一个实体，自动化可直接引用） ──
    last_field_sensors = [
        LastFieldSensor(coordinator, entry, "mood",        "心情",       "mdi:emoticon-happy",   _MOOD_TEXT),
        LastFieldSensor(coordinator, entry, "pleasure",   "愉悦程度",   "mdi:star",             unit="/10"),
        LastFieldSensor(coordinator, entry, "duration",    "持续时长",   "mdi:timer",            unit="分钟"),
        LastFieldSensor(coordinator, entry, "foreplay",    "前戏时长",   "mdi:hand-front-left",  unit="分钟"),
        LastFieldSensor(coordinator, entry, "location",    "地点",       "mdi:map-marker"),
        LastFieldSensor(coordinator, entry, "libido",     "性欲强度",   "mdi:fire",             _LIBIDO_TEXT),
        LastFieldSensor(coordinator, entry, "orgasm",      "高潮次数",   "mdi:boom",             unit="次"),
        LastFieldSensor(coordinator, entry, "alcohol",     "酒精影响",   "mdi:glass-wine",       _ALCOHOL_TEXT),
        LastFieldSensor(coordinator, entry, "contraception","避孕措施",  "mdi:shield",           _CONTRACEPTION_TEXT),
        LastFieldSensor(coordinator, entry, "category",     "类别",      "mdi:tag-multiple",     _CATEGORY_TEXT),
        LastFieldSensor(coordinator, entry, "physical_state","身体状态",  "mdi:run",             _PHYSICAL_TEXT),
        LastFieldSensor(coordinator, entry, "sleep_quality","睡眠质量",   "mdi:sleep",            _SLEEP_TEXT),
        LastFieldSensor(coordinator, entry, "initiator",    "主动方",     "mdi:account-group"),
        LastFieldSensor(coordinator, entry, "cooperation",  "伴侣配合度", "mdi:handshake",        _COOPERATION_TEXT),
        LastFieldSensor(coordinator, entry, "condom",       "带套",       "mdi:condom",           {True: "✅是", False: "❌否"}),
        LastFieldSensor(coordinator, entry, "sex_toy",      "情趣玩具",   "mdi:gift",             {True: "✅是", False: "❌否"}),
        LastFieldSensor(coordinator, entry, "position",     "体位",       "mdi:human-handsup"),
        LastFieldSensor(coordinator, entry, "method",       "做爱方式",   "mdi:heart-pulse"),
        LastFieldSensor(coordinator, entry, "ejaculation", "射精位置",    "mdi:water-sync"),
        LastFieldSensor(coordinator, entry, "mood",        "心情(英文)", "mdi:translate"),
    ]
    async_add_entities(last_field_sensors)

    # ── 趋势统计 ──
    async_add_entities([
        PositionStatsSensor(coordinator, entry),
        LocationStatsSensor(coordinator, entry),
        MoodTrendSensor(coordinator, entry),
        ContraceptionTrendSensor(coordinator, entry),
    ])

    # ── 历史记录列表（attributes 中展示近10条） ──
    async_add_entities([RecentRecordsSensor(coordinator, entry)])


# ── 工具函数 ──
def _latest(records):
    return max(records, key=lambda r: r.get("date", "")) if records else None


def _sorted(records):
    return sorted(records, key=lambda r: r.get("date", ""), reverse=True)


def _last_k(records, key, k=5):
    """最近 k 条有值记录的 key 列表"""
    vals, seen = [], set()
    for r in _sorted(records):
        v = r.get(key)
        if v not in (None, "", 0) and str(v) not in seen:
            vals.append(v)
            seen.add(str(v))
            if len(vals) >= k:
                break
    return vals


def _most_common(records, key):
    vals = [r.get(key) for r in records if r.get(key) not in (None, "")]
    if not vals:
        return "—"
    return Counter(vals).most_common(1)[0][0]


def _period_status(data):
    settings, periods = data.get("settings", {}), data.get("periods", [])
    now = datetime.now()
    cl = settings.get("cycle_length", 28)
    pd = settings.get("period_length", 5)
    sd = settings.get("safe_period_days", 7)
    phase, is_safe = "未知", False
    next_period = None

    if periods:
        last = max(periods, key=lambda x: x.get("start_date", ""))
        try:
            last_start = datetime.strptime(last["start_date"], "%Y-%m-%d")
            next_period = (last_start + timedelta(days=cl)).strftime("%m-%d")
            days_since = (now - last_start).days
            if days_since >= 0:
                cd = days_since % cl
                if cd < pd:
                    phase = "经期"; is_safe = False
                elif cd >= cl - sd:
                    phase = "安全期"; is_safe = True
                else:
                    phase = "易孕期"; is_safe = False
        except Exception:
            pass

    return dict(phase=phase, is_safe=is_safe, next_period=next_period,
                cl=cl, pd=pd, sd=sd)


# ── 基类 ──
class IntimacyEntity(Entity):
    _attr_icon = "mdi:heart"

    def __init__(self, coordinator, entry):
        self.coord = coordinator
        self._entry_id = entry.entry_id
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "私密记录",
            "manufacturer": "Custom",
        }

    @property
    def available(self):
        return self.coord.data is not None


# ═══════════════════════════════════════════════
#  统计类
# ═══════════════════════════════════════════════
class StatisticsSensor(IntimacyEntity, SensorEntity):
    """综合统计：总次数/本年/本月/本周/平均愉悦/平均时长"""
    _attr_unique_id = "intimacy_statistics"
    _attr_name = "私密记录_统计"
    _attr_icon = "mdi:chart-bar"
    _attr_state_class = "measurement"

    @property
    def state(self):
        return len(self.coord.data.get("records", []))

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        now = datetime.now()
        y_start = now.replace(month=1, day=1, hour=0, minute=0, second=0)
        m_start = now.replace(day=1, hour=0, minute=0, second=0)
        w_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0)
        def dt(s):
            try: return datetime.strptime(s[:10], "%Y-%m-%d")
            except: return datetime.min
        pleasures = [r.get("pleasure", 0) for r in records if r.get("pleasure")]
        durations = [r.get("duration", 0) for r in records if r.get("duration")]
        return {
            "总次数": len(records),
            "本年次数": sum(1 for r in records if dt(r.get("date","")) >= y_start),
            "本月次数": sum(1 for r in records if dt(r.get("date","")) >= m_start),
            "本周次数": sum(1 for r in records if dt(r.get("date","")) >= w_start),
            "平均愉悦": round(sum(pleasures)/len(pleasures), 1) if pleasures else 0,
            "平均时长": round(sum(durations)/len(durations), 1) if durations else 0,
        }


class PleasureTrendSensor(IntimacyEntity, SensorEntity):
    """愉悦趋势：最近5次愉悦值（用于历史图表）"""
    _attr_unique_id = "intimacy_pleasure_trend"
    _attr_name = "私密记录_愉悦趋势"
    _attr_icon = "mdi:trend-neutral"
    _attr_state_class = "measurement"
    _attr_native_unit_of_measurement = "/10"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        latest = _latest(records)
        return latest.get("pleasure", 0) if latest else 0

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        vals = _last_k(records, "pleasure", 5)
        dates = _last_k(records, "date", 5)
        return {
            "近5次愉悦": vals,
            "近5次日期": dates,
            "趋势": "↑" if len(vals) >= 2 and vals[0] > vals[1] else ("↓" if len(vals) >= 2 and vals[0] < vals[1] else "→"),
        }


class FrequencyTrendSensor(IntimacyEntity, SensorEntity):
    """频率趋势：近30天次数"""
    _attr_unique_id = "intimacy_frequency_trend"
    _attr_name = "私密记录_近30天次数"
    _attr_icon = "mdi:calendar-check"
    _attr_state_class = "measurement"
    _attr_native_unit_of_measurement = "次"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        cutoff = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        return sum(1 for r in records if r.get("date", "") >= cutoff)

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        def dt(s):
            try: return datetime.strptime(s[:10], "%Y-%m-%d")
            except: return datetime.min
        d7 = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        d14 = (datetime.now() - timedelta(days=14)).strftime("%Y-%m-%d")
        d30 = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        c7 = sum(1 for r in records if r.get("date", "") >= d7)
        c14 = sum(1 for r in records if r.get("date", "") >= d14)
        c30 = sum(1 for r in records if r.get("date", "") >= d30)
        return {"近7天": c7, "近14天": c14, "近30天": c30}


# ═══════════════════════════════════════════════
#  周期类
# ═══════════════════════════════════════════════
class PeriodNextSensor(IntimacyEntity, SensorEntity):
    """下次经期预计日期"""
    _attr_unique_id = "intimacy_period_next"
    _attr_name = "私密记录_下次经期"
    _attr_icon = "mdi:calendar-clock"

    @property
    def state(self):
        st = _period_status(self.coord.data)
        return st.get("next_period") or "未知"

    @property
    def extra_state_attributes(self):
        st = _period_status(self.coord.data)
        return {
            "周期长度": f"{st['cl']}天",
            "经期长度": f"{st['pd']}天",
            "安全期天数": f"{st['sd']}天",
        }


class PeriodPhaseSensor(IntimacyEntity, SensorEntity):
    """当前周期阶段：经期/易孕期/安全期"""
    _attr_unique_id = "intimacy_period_phase"
    _attr_name = "私密记录_周期阶段"
    _attr_icon = "mdi:water"

    @property
    def state(self):
        st = _period_status(self.coord.data)
        return st.get("phase", "未知")

    @property
    def icon(self):
        return _PHASE_ICON.get(self.state, "mdi:help-circle")

    @property
    def extra_state_attributes(self):
        st = _period_status(self.coord.data)
        return {
            "是否安全": "✅ 安全" if st["is_safe"] else "❌ 不安全",
            "预计下次经期": st.get("next_period") or "未知",
        }


class PeriodDaysLeftSensor(IntimacyEntity, SensorEntity):
    """经期剩余天数（正在经期中时显示）"""
    _attr_unique_id = "intimacy_period_days_left"
    _attr_name = "私密记录_经期剩余"
    _attr_icon = "mdi:water"
    _attr_native_unit_of_measurement = "天"
    _attr_state_class = "measurement"

    @property
    def state(self):
        st = _period_status(self.coord.data)
        if st.get("phase") == "经期":
            # 估算经期还剩多少天
            settings = self.coord.data.get("settings", {})
            pd = settings.get("period_length", 5)
            periods = self.coord.data.get("periods", [])
            if periods:
                last = max(periods, key=lambda x: x.get("start_date", ""))
                try:
                    last_start = datetime.strptime(last["start_date"], "%Y-%m-%d")
                    days_since = (datetime.now() - last_start).days
                    return max(0, pd - days_since)
                except Exception:
                    pass
            return pd
        return "—"

    @property
    def extra_state_attributes(self):
        return {"状态": self.state if self.state != "—" else "非经期"}


# ═══════════════════════════════════════════════
#  上次记录详情（每字段一个独立实体）
# ═══════════════════════════════════════════════
class LastFieldSensor(IntimacyEntity, SensorEntity):
    """通用单字段上次值传感器"""

    def __init__(self, coordinator, entry, key, label, icon="mdi:heart",
                 mapping=None, unit=None, state_class=None):
        super().__init__(coordinator, entry)
        self._key = key
        self._label = label
        self._mapping = mapping or {}
        self._unit = unit
        self._state_class = state_class
        self._attr_unique_id = f"intimacy_last_{key}"
        self._attr_name = f"私密记录_上次{label}"
        self._attr_icon = icon

    @property
    def native_unit_of_measurement(self):
        return self._unit

    @property
    def state_class(self):
        return self._state_class

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        latest = _latest(records)
        if not latest:
            return "—"
        v = latest.get(self._key)
        if v is None or v == "" or v == 0:
            return "—"
        if self._mapping:
            return self._mapping.get(v, v)
        # 心情字段英文转中文
        if self._key == "mood" and not self._mapping and v in _MOOD_TEXT:
            return _MOOD_TEXT.get(v, v)
        return v

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        latest = _latest(records)
        k = self._key
        # 近5次
        recent_vals = _last_k(records, k, 5)
        recent_dates = _last_k(records, "date", 5)
        attrs = {
            "近5次": recent_vals,
            "近5次日期": recent_dates,
        }
        if latest and latest.get(k):
            attrs["上次日期"] = latest.get("date", "—")
        return attrs


# ═══════════════════════════════════════════════
#  趋势统计
# ═══════════════════════════════════════════════
class PositionStatsSensor(IntimacyEntity, SensorEntity):
    """最常用体位"""
    _attr_unique_id = "intimacy_position_stats"
    _attr_name = "私密记录_最常用体位"
    _attr_icon = "mdi:human-handsup"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        return _most_common(records, "position")

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        all_positions = [p for r in records for p in str(r.get("position", "")).split("、") if p]
        if not all_positions:
            return {"常用体位排行": []}
        top = Counter(all_positions).most_common(5)
        return {"常用体位排行": [{"体位": p, "次数": c} for p, c in top]}


class LocationStatsSensor(IntimacyEntity, SensorEntity):
    """最常用地点"""
    _attr_unique_id = "intimacy_location_stats"
    _attr_name = "私密记录_最常用地点"
    _attr_icon = "mdi:map-marker"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        return _most_common(records, "location")

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        all_locs = [r.get("location") for r in records if r.get("location")]
        if not all_locs:
            return {"地点排行": []}
        top = Counter(all_locs).most_common(5)
        return {"地点排行": [{"地点": l, "次数": c} for l, c in top]}


class MoodTrendSensor(IntimacyEntity, SensorEntity):
    """心情历史链"""
    _attr_unique_id = "intimacy_mood_trend"
    _attr_name = "私密记录_最近心情"
    _attr_icon = "mdi:emoticon-happy-outline"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        latest = _latest(records)
        v = latest.get("mood") if latest else None
        return _MOOD_TEXT.get(v, v or "—")

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        moods = _last_k(records, "mood", 10)
        dates = _last_k(records, "date", 10)
        moods_zh = [_MOOD_TEXT.get(m, m) for m in moods]
        return {
            "近10次心情": moods_zh,
            "近10次日期": dates,
        }


class ContraceptionTrendSensor(IntimacyEntity, SensorEntity):
    """避孕方式历史链"""
    _attr_unique_id = "intimacy_contraception_trend"
    _attr_name = "私密记录_避孕方式链"
    _attr_icon = "mdi:shield"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        latest = _latest(records)
        v = latest.get("contraception") if latest else None
        return _CONTRACEPTION_TEXT.get(v, v or "—")

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        cts = _last_k(records, "contraception", 10)
        dates = _last_k(records, "date", 10)
        cts_zh = [_CONTRACEPTION_TEXT.get(c, c) for c in cts]
        return {
            "近10次避孕": cts_zh,
            "近10次日期": dates,
        }


# ═══════════════════════════════════════════════
#  历史记录列表
# ═══════════════════════════════════════════════
class RecentRecordsSensor(IntimacyEntity, SensorEntity):
    """近10条历史记录摘要（所有字段扁平化）"""
    _attr_unique_id = "intimacy_recent_records"
    _attr_name = "私密记录_最近10条"
    _attr_icon = "mdi:format-list-bulleted"

    @property
    def state(self):
        records = self.coord.data.get("records", [])
        latest = _latest(records)
        return latest.get("date", "无记录") if latest else "无记录"

    @property
    def extra_state_attributes(self):
        records = self.coord.data.get("records", [])
        recent = _sorted(records)[:10]

        def fmt(r, key, mapping=None):
            v = r.get(key)
            if mapping and v:
                return mapping.get(v, v)
            return v if v is not None else "—"

        items = []
        for i, r in enumerate(recent):
            items.append({
                "序号": i + 1,
                "日期": r.get("date", "—"),
                "时间": r.get("time", "—"),
                "地点": r.get("location", "—"),
                "时长": f"{r.get('duration', 0)}分钟",
                "前戏": f"{r.get('foreplay', 0)}分钟",
                "愉悦": f"{r.get('pleasure', 0)}/10",
                "心情": fmt(r, "mood", _MOOD_TEXT),
                "性欲": fmt(r, "libido", _LIBIDO_TEXT),
                "高潮": f"{r.get('orgasm', 0)}次",
                "酒精": fmt(r, "alcohol", _ALCOHOL_TEXT),
                "避孕": fmt(r, "contraception", _CONTRACEPTION_TEXT),
                "内射": fmt(r, "cumshot", _CUMSHOT_TEXT),
                "身体": fmt(r, "physical_state", _PHYSICAL_TEXT),
                "睡眠": fmt(r, "sleep_quality", _SLEEP_TEXT),
                "主动方": r.get("initiator", "—") or "—",
                "带套": "✅" if r.get("condom") else "❌",
                "玩具": "✅" if r.get("sex_toy") else "❌",
                "体位": r.get("position", "—") or "—",
                "方式": r.get("method", "—") or "—",
                "射精": r.get("ejaculation", "—") or "—",
                "备注": r.get("notes", "") or "",
            })

        return {"记录列表": items, "总计": len(records)}
