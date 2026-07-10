// 私密记录 v4.0 - 完整重写
(function() {
    'use strict';
    var API = '/intimacy_data';
    var VERSION = '5.3.0';

    // 全局状态
    var state = {
        records: [],
        periods: [],
        settings: {cycle_length:28, period_length:5, safe_period_days:7, ovulation_buffer_days:5},
        stats: {},
        currentMonth: new Date(),
        editingRecordId: null,
        viewRecordId: null,
        timer: { running: false, startTime: 0, elapsed: 0, intervalId: null },
        statsRange: 'all',
        statsYear: '',
        pickerYear: new Date().getFullYear(),
    };

    var $ = function(id) { return document.getElementById(id); };

    // ── API ──
    function apiGet(action, params) {
        var url = API + '?action=' + action;
        if (params) {
            Object.keys(params).forEach(function(k) {
                if (params[k] !== undefined && params[k] !== null && params[k] !== '')
                    url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
            });
        }
        console.log('[Intimacy] apiGet:', url);
        return fetch(url, {method:'GET', credentials:'include'}).then(function(r) {
            console.log('[Intimacy] apiGet response:', r.status, r.ok);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).catch(function(e) {
            console.error('[Intimacy] apiGet error:', e);
            throw e;
        });
    }

    function apiPost(action, body) {
        console.log('[Intimacy] apiPost:', action, body);
        return fetch(API, {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(Object.assign({action: action}, body))
        }).then(function(r) {
            console.log('[Intimacy] apiPost response:', r.status, r.ok);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).catch(function(e) {
            console.error('[Intimacy] apiPost error:', e);
            throw e;
        });
    }

    // ── 数据加载 ──
    function loadAll() {
        console.log('[Intimacy] loadAll start');
        return Promise.all([
            apiGet('get_stats'),
            apiGet('get_records'),
            apiGet('get_periods'),
            apiGet('get_settings'),
        ]).then(function(results) {
            console.log('[Intimacy] results:', results);
            state.stats = results[0] || {};
            state.records = results[1].records || [];
            state.periods = results[2].periods || [];
            state.settings = results[3].settings || state.settings;
            console.log('[Intimacy] records:', state.records.length, 'periods:', state.periods.length);
            renderQuickStats();
            renderCalendar();
            renderRecords();
            renderStats();
            renderPeriods();
            updateSettingsForm();
            updateSafeBadge();
            buildFilterOptions();
        }).catch(function(e) {
            console.error('[Intimacy] loadAll error:', e);
        });
    }

    // ── 快捷统计 ──
    function renderQuickStats() {
        var s = state.stats;
        $('qsTotal').textContent = s.total_count || 0;
        $('qsMonth').textContent = s.month_count || 0;
        $('qsYear').textContent = s.year_count || 0;
        $('qsAvg').textContent = s.avg_pleasure || 0;
    }

    // ── 日历年月快速选择 ──
    function toggleCalendarPicker() {
        var picker = $('calendarPicker');
        if (!picker) return;
        if (picker.classList.contains('active')) {
            hideCalendarPicker();
        } else {
            state.pickerYear = state.currentMonth.getFullYear();
            renderPickerMonths();
            picker.classList.add('active');
        }
    }
    function hideCalendarPicker() {
        var picker = $('calendarPicker');
        if (picker) picker.classList.remove('active');
    }
    function renderPickerMonths() {
        var y = state.pickerYear || new Date().getFullYear();
        $('pickerYear').textContent = y + '年';
        var curY = state.currentMonth.getFullYear();
        var curM = state.currentMonth.getMonth();
        var html = '';
        var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
        for (var i = 0; i < 12; i++) {
            var isCurrent = (y === curY && i === curM);
            html += '<button class="picker-month-btn' + (isCurrent ? ' current' : '') + '" data-month="' + i + '">' + monthNames[i] + '</button>';
        }
        $('pickerMonths').innerHTML = html;
    }

    // ── 日历热力图 ──
    function renderCalendar() {
        var mo = state.currentMonth;
        var year = mo.getFullYear();
        var month = mo.getMonth();
        $('calendarTitle').textContent = year + '年' + (month + 1) + '月';

        var grid = $('calendarGrid');
        grid.innerHTML = '';

        // 统计当月每天的记录（按类别）
        var dayMap = {};
        state.records.forEach(function(r) {
            if ((r.date || '').substring(0, 7) !== year + '-' + String(month+1).padStart(2,'0')) return;
            if (!dayMap[r.date]) dayMap[r.date] = [];
            dayMap[r.date].push(r.category || 'sex');
        });

        // 经期天数
        var periodDays = new Set();
        state.periods.forEach(function(p) {
            if (!p.start_date) return;
            var s = new Date(p.start_date);
            var e = p.end_date ? new Date(p.end_date) : new Date(s.getTime() + (state.settings.period_length || 5) * 86400000);
            for (var d = new Date(s); d <= e; d.setDate(d.getDate()+1)) {
                periodDays.add(d.toISOString().substring(0,10));
            }
        });

        // ── 周期阶段判断 ──
        function _getPhase(dateStr) {
            var periods = state.periods;
            var st = state.settings;
            if (!periods.length) return 'none';
            var last = periods.reduce(function(a, b) {
                return (b.start_date || '') > (a.start_date || '') ? b : a;
            });
            var cl = st.cycle_length || 28;
            var pd = st.period_length || 5;
            var sd = st.safe_period_days || 7;
            try {
                var d = new Date(dateStr);
                var lastStart = new Date(last.start_date);
                var daysSince = Math.floor((d - lastStart) / 86400000);
                if (daysSince < 0) return 'none';
                var cd = daysSince % cl;
                if (cd < pd) return 'period';
                if (cd >= cl - sd) return 'safe';
                return 'fertile';
            } catch(e) {
                return 'none';
            }
        }

        // 星期对齐（周一=0）
        var firstDay = new Date(year, month, 1).getDay() || 7;
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var today = new Date();

        // 空白格
        for (var i = 1; i < firstDay; i++) {
            var empty = document.createElement('div');
            empty.className = 'cal-cell empty';
            grid.appendChild(empty);
        }

        // 日期格
        for (var d = 1; d <= daysInMonth; d++) {
            var ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
            var isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            var cats = dayMap[ds] || [];
            var inPeriod = periodDays.has(ds);
            var phase = _getPhase(ds);
            var countClass = cats.length === 0 ? 'none' : cats.length === 1 ? 'cnt-1' : cats.length === 2 ? 'cnt-2' : 'cnt-3';

            var cell = document.createElement('div');
            cell.className = 'cal-cell' +
                (isToday ? ' today' : '') +
                (phase === 'period' ? ' period-day' : '') +
                (phase === 'safe'   ? ' safe-day'   : '') +
                (phase === 'fertile'? ' fertile-day': '');
            cell.dataset.date = ds;
            cell.dataset.count = cats.length;
            // Store record IDs for this day
            var dayRecs = state.records.filter(function(r) { return r.date === ds; });
            cell.dataset.ids = dayRecs.map(function(r) { return r.id; }).join(',');

            var dayNum = document.createElement('span');
            dayNum.className = 'cal-day-num';
            dayNum.textContent = d;
            cell.appendChild(dayNum);

            if (cats.length > 0) {
                // Show first record's summary info
                var firstRec = dayRecs[0];
                var moodIcon = {happy:'icon-mood-happy',romantic:'icon-mood-romantic',passionate:'icon-mood-excited',tired:'icon-mood-tired',calm:'icon-mood-calm',wild:'icon-zap',tender:'icon-heart-hand',frustrated:'icon-mood-sad',curious:'icon-thought',sober:'icon-meh',expect:'icon-sparkle',satisfied:'icon-mood-satisfied',surprised:'icon-mood-excited',regret:'icon-mood-sad',wanting:'icon-heart'}[firstRec.mood] || 'icon-mood-happy';
                var dur = firstRec.duration || 0;
                var timeStr = (firstRec.time || '').substring(0, 5);

                var infoWrap = document.createElement('span');
                infoWrap.className = 'cal-info';
                // Time
                if (timeStr) {
                    var timeEl = document.createElement('span');
                    timeEl.className = 'cal-info-time';
                    timeEl.textContent = timeStr;
                    infoWrap.appendChild(timeEl);
                }
                // Mood icon + Duration
                var metaEl = document.createElement('span');
                metaEl.className = 'cal-info-meta';
                metaEl.innerHTML = '<svg class="icon ' + moodIcon + '"><use href="#' + moodIcon + '"/></svg>' + (dur ? ' ' + dur + '\'' : '');
                infoWrap.appendChild(metaEl);

                // Category badge (tiny)
                if (cats.length > 1) {
                    var badgeEl = document.createElement('span');
                    badgeEl.className = 'cal-info-badge';
                    badgeEl.textContent = '+' + (cats.length - 1);
                    infoWrap.appendChild(badgeEl);
                }

                cell.appendChild(infoWrap);

                // 类别圆点
                var dotWrap = document.createElement('span');
                dotWrap.className = 'cal-dots';
                var dotSet = {};
                cats.forEach(function(c){ dotSet[c] = true; });
                if (dotSet['sex']) {
                    var dot = document.createElement('span');
                    dot.className = 'cal-dot dot-sex';
                    dotWrap.appendChild(dot);
                }
                if (dotSet['masturbation']) {
                    var dot = document.createElement('span');
                    dot.className = 'cal-dot dot-mast';
                    dotWrap.appendChild(dot);
                }
                if (dotSet['dream']) {
                    var dot = document.createElement('span');
                    dot.className = 'cal-dot dot-dream';
                    dotWrap.appendChild(dot);
                }
                cell.appendChild(dotWrap);
                cell.title = ds + ' 有' + cats.length + '条记录';
            }

            grid.appendChild(cell);
        }
    }

    // ── 筛选配置 ──
    var FILTER_CONFIG = {
        category: { title: '类别', options: [
            {val:'sex',label:'做爱'},{val:'masturbation',label:'自慰'},{val:'dream',label:'春梦'}
        ]},
        location: { title: '地点', options: [
            {val:'卧室',label:'卧室'},{val:'客厅',label:'客厅'},{val:'浴室',label:'浴室'},{val:'酒店',label:'酒店'},{val:'户外',label:'户外'},{val:'车内',label:'车内'}
        ]},
        mood: { title: '心情', options: [
            {val:'happy',label:'开心'},{val:'romantic',label:'浪漫'},{val:'passionate',label:'激情'},{val:'tired',label:'疲惫'},{val:'calm',label:'平淡'},{val:'wild',label:'狂野'},{val:'tender',label:'温柔'},{val:'frustrated',label:'失落'},{val:'curious',label:'好奇'},{val:'sober',label:'清醒'},{val:'expect',label:'期待'},{val:'satisfied',label:'满足'},{val:'surprised',label:'惊喜'},{val:'regret',label:'遗憾'},{val:'wanting',label:'意犹未尽'}
        ]},
        initiator: { title: '谁主动', options: [
            {val:'我',label:'我'},{val:'伴侣',label:'伴侣'},{val:'双方主动',label:'双方主动'}
        ]},
        contraception: { title: '避孕', options: [
            {val:'condom',label:'安全套'},{val:'none',label:'无保护'},{val:'pill',label:'避孕药'},{val:'iud',label:'节育器'},{val:'withdrawal',label:'体外'},{val:'safe',label:'安全期'},{val:'planb',label:'紧急避孕'}
        ]},
        position: { title: '体位', options: [
            {val:'传教士',label:'传教士'},{val:'女上',label:'女上'},{val:'后入',label:'后入'},{val:'站立',label:'站立'},{val:'坐姿',label:'坐姿'},{val:'侧入',label:'侧入'}
        ]},
        method: { title: '方式', options: [
            {val:'阴道性交',label:'阴道性交'},{val:'口交',label:'口交'},{val:'手交',label:'手交'},{val:'肛交',label:'肛交'},{val:'足交',label:'足交'},{val:'乳交',label:'乳交'}
        ]},
        toy_detail: { title: '玩具', options: [
            {val:'跳蛋',label:'跳蛋'},{val:'震动棒',label:'震动棒'},{val:'假阳具',label:'假阳具'},{val:'飞机杯',label:'飞机杯'},{val:'润滑剂',label:'润滑剂'},{val:'特殊道具',label:'特殊道具'}
        ]},
        ejaculation: { title: '射精', options: [
            {val:'阴道内',label:'阴道内'},{val:'体外',label:'体外'},{val:'口内',label:'口内'},{val:'脸上',label:'脸上'},{val:'手上',label:'手上'},{val:'肚子上',label:'肚子上'},{val:'其他',label:'其他'}
        ]},
        alcohol: { title: '酒精', options: [
            {val:'none',label:'无'},{val:'light',label:'微醺'},{val:'moderate',label:'适量'},{val:'heavy',label:'较多'}
        ]},
        sleep_quality: { title: '睡眠', options: [
            {val:'bad',label:'很差'},{val:'poor',label:'较差'},{val:'normal',label:'一般'},{val:'good',label:'较好'},{val:'great',label:'很好'}
        ]}
    };
    // 当前筛选状态
    state.filter = state.filter || {};

    // ── 记录列表 ──
    function renderRecords() {
        var monthFilter = $('filterMonth').value;
        var records = state.records.slice();

        if (monthFilter) {
            records = records.filter(function(r) { return (r.date||'').substring(0,7) === monthFilter; });
        }
        // 应用所有图标筛选
        Object.keys(state.filter).forEach(function(key) {
            var val = state.filter[key];
            if (!val) return;
            if (key === 'position' || key === 'method' || key === 'toy_detail' || key === 'ejaculation') {
                // 多值字段（逗号分隔）
                records = records.filter(function(r) {
                    var fieldVal = r[key] || '';
                    return fieldVal.split('、').indexOf(val) !== -1;
                });
            } else {
                records = records.filter(function(r) { return (r[key]||'') === val; });
            }
        });

        records.sort(function(a,b) { return (b.date||'') < (a.date||'') ? -1 : 1; });

        // 按年份分组
        var yearMap = {};
        var yearOrder = [];
        records.forEach(function(r) {
            var y = (r.date||'').substring(0,4) || '未知';
            var m = (r.date||'').substring(0,7) || '未知';
            if (!yearMap[y]) { yearMap[y] = {}; yearOrder.push(y); }
            if (!yearMap[y][m]) yearMap[y][m] = [];
            yearMap[y][m].push(r);
        });

        var list = $('recordList');
        if (!records.length) {
            list.innerHTML = '<p class="empty-hint">暂无记录</p>';
            return;
        }

        var html = '';
        yearOrder.forEach(function(y) {
            var monthMap = yearMap[y];
            var monthOrder = Object.keys(monthMap).sort().reverse();
            var totalCount = monthOrder.reduce(function(s,m){ return s + monthMap[m].length; }, 0);
            html += '<div class="year-group">' +
                '<div class="year-header" onclick="toggleGroup(this)">' +
                    '<span>'+y+'年 <span class="count">'+totalCount+'条</span></span>' +
                    '<span class="arrow">▶</span>' +
                '</div>' +
                '<div class="year-body">';

            monthOrder.forEach(function(ym) {
                var recs = monthMap[ym];
                var mLabel = parseInt(ym.substring(5,7));
                html += '<div class="month-group">' +
                    '<div class="month-header" onclick="toggleGroup(this)">' +
                        '<span>'+mLabel+'月 <span class="count">'+recs.length+'条</span></span>' +
                        '<span class="arrow">▶</span>' +
                    '</div>' +
                    '<div class="month-body">';

                recs.forEach(function(r) {
            var pleasureEmo = ratingEmoji(r.pleasure);
            var cat = r.category || 'sex';
            var catBadge = cat === 'masturbation'
                ? '<span class="badge badge-mast"><svg class="icon"><use href="#icon-hand"/></svg> 自慰</span>'
                : '<span class="badge badge-sex"><svg class="icon"><use href="#icon-users"/></svg> 做爱</span>';
            var toyIcon = r.sex_toy ? '<span class="badge badge-toy">玩具</span>' : '';
            var ejaculationList = r.ejaculation ? r.ejaculation.split('、') : [];
            var cumshotBadge = '';
            if (ejaculationList.length) {
                cumshotBadge = ejaculationList.map(function(e) {
                    return '<span class="badge" style="background:rgba(255,152,0,.2);color:#ff9800;">'+escHtml(e)+'</span>';
                }).join('');
            }
            var ejList = r.ejaculation ? '<div class="rc-tags">'+r.ejaculation.split('、').map(function(e){ return '<span class="rc-tag rc-tag-ej">'+escHtml(e)+'</span>'; }).join('')+'</div>' : '';
            var sleepIcon = {bad:'<svg class="icon"><use href="#icon-frown"/></svg>',poor:'<svg class="icon"><use href="#icon-frown"/></svg>',normal:'',good:'<svg class="icon"><use href="#icon-smile"/></svg>',great:'<svg class="icon"><use href="#icon-moon"/></svg>'}[r.sleep_quality]||'';
            var posList = r.position ? '<div class="rc-tags">'+r.position.split('、').map(function(p){ return '<span class="rc-tag">'+escHtml(p)+'</span>'; }).join('')+'</div>' : '';
            var methodList = r.method ? '<div class="rc-tags">'+r.method.split('、').map(function(m){ return '<span class="rc-tag rc-tag-method">'+escHtml(m)+'</span>'; }).join('')+'</div>' : '';
            var toyList = r.toy_detail ? '<div class="rc-tags">'+r.toy_detail.split('、').map(function(t){ return '<span class="rc-tag vd-tag-toy">'+escHtml(t)+'</span>'; }).join('')+'</div>' : '';
            var moodText = {happy:'开心',romantic:'浪漫',passionate:'激情',tired:'疲惫',calm:'平淡',wild:'狂野',tender:'温柔',frustrated:'失落',curious:'好奇',sober:'清醒',expect:'期待',satisfied:'满足',surprised:'惊喜',regret:'遗憾',wanting:'意犹未尽'}[r.mood]||'';
            var contraceptionShort = {condom:'安全套',none:'无保护',pill:'避孕药',iud:'节育器',withdrawal:'体外',safe:'安全期',planb:'紧急避孕'}[r.contraception]||'';
            html += '<div class="record-card" data-id="'+r.id+'">' +
                '<div class="rc-header">' +
                    '<div class="rc-date">'+r.date+' <span class="rc-time">'+(r.time||'')+'</span></div>' +
                    '<div class="rc-badges">'+catBadge+toyIcon+cumshotBadge+'</div>' +
                '</div>' +
                '<div class="rc-body collapsed">' +
                    // 1. 时间（已在 header 显示）
                    // 2. 持续时间
                    '<div class="rc-row"><span class="rc-label">时长</span><span class="rc-value">'+r.duration+'分钟</span></div>' +
                    // 3. 体位
                    (posList ? '<div class="rc-row"><span class="rc-label">体位</span><span class="rc-tags">'+posList+'</span></div>' : '') +
                    // 4. 避孕措施
                    (contraceptionShort ? '<div class="rc-row"><span class="rc-label">避孕</span><span class="rc-value">'+escHtml(contraceptionShort)+'</span></div>' : '') +
                    // 5. 做爱方式
                    (methodList ? '<div class="rc-row"><span class="rc-label">方式</span><span class="rc-tags">'+methodList+'</span></div>' : '') +
                    // 6. 高潮次数
                    (r.orgasm ? '<div class="rc-row"><span class="rc-label">高潮</span><span class="rc-value">'+r.orgasm+'次</span></div>' : '') +
                    // 7. 前戏时长
                    (r.foreplay ? '<div class="rc-row"><span class="rc-label">前戏</span><span class="rc-value">'+r.foreplay+'分钟</span></div>' : '') +
                    // 8. 谁主动
                    (r.initiator ? '<div class="rc-row"><span class="rc-label">主动</span><span class="rc-value">'+escHtml(r.initiator)+'</span></div>' : '') +
                    // 9. 伴侣配合度
                    (r.cooperation ? '<div class="rc-row"><span class="rc-label">配合度</span><span class="rc-value">'+r.cooperation+'/5</span></div>' : '') +
                    // 10. 心情
                    (moodText ? '<div class="rc-row"><span class="rc-label">心情</span><span class="rc-value">'+moodText+'</span></div>' : '') +
                    // 11. 近期睡眠质量
                    (r.sleep_quality ? '<div class="rc-row"><span class="rc-label">睡眠</span><span class="rc-value">'+sleepIcon+'</span></div>' : '') +
                    // 12. 愉悦程度
                    '<div class="rc-row"><span class="rc-label">愉悦</span><span class="rc-value rc-pleasure"><svg class="icon"><use href="#icon-star"/></svg> '+r.pleasure+'/10</span></div>' +
                    (ejList ? '<div class="rc-row"><span class="rc-label">射精</span><span class="rc-tags">'+ejList+'</span></div>' : '') +
                    (toyList ? '<div class="rc-row"><span class="rc-label">玩具</span><span class="rc-tags">'+toyList+'</span></div>' : '') +
                    (r.notes ? '<div class="rc-notes"><svg class="icon"><use href="#icon-edit"/></svg> '+escHtml(r.notes)+'</div>' : '') +
                '</div>' +
                '<div class="rc-footer">' +
                    '<button class="rc-btn edit" data-id="'+r.id+'">编辑</button>' +
                    '<button class="rc-btn delete" data-id="'+r.id+'">删除</button>' +
                '</div>' +
            '</div>';
        });
            html += '</div></div>';
            });
            html += '</div></div>';
        });
        list.innerHTML = html;
    }

    // 折叠/展开年份或月份分组
    window.toggleGroup = function(header) {
        var body = header.nextElementSibling;
        if (!body) return;
        var isOpen = body.classList.contains('open');
        if (isOpen) {
            body.classList.remove('open');
            header.classList.remove('open');
        } else {
            body.classList.add('open');
            header.classList.add('open');
        }
    };

    // ── 统计视图 ──
    function getStatsRecs() {
        var recs = state.records || [];
        var range = state.statsRange;
        if (range === 'all') return recs;
        var now = new Date();
        var start;
        if (range === 'week') {
            start = new Date(now);
            start.setDate(now.getDate() - now.getDay() + 1);
            start.setHours(0,0,0,0);
        } else if (range === 'month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (range === 'halfyear') {
            start = new Date(now);
            start.setMonth(now.getMonth() - 6);
            start.setHours(0,0,0,0);
        } else if (range === 'year') {
            start = new Date(now.getFullYear(), 0, 1);
        } else if (range === 'prev') {
            var y = state.statsYear;
            if (y) {
                return recs.filter(function(r) {
                    return (r.date||'').substring(0,4) === y;
                });
            }
            var yearStart = new Date(now.getFullYear(), 0, 1);
            return recs.filter(function(r) {
                var d = new Date(r.date);
                return d < yearStart;
            });
        }
        return recs.filter(function(r) {
            var d = new Date(r.date);
            return d >= start;
        });
    }

    function renderStats() {
        var s = state.stats;
        var recs = getStatsRecs();
        var now = new Date();
        var yearStart = new Date(now.getFullYear(), 0, 1);
        var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        var weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay() + 1);
        weekStart.setHours(0,0,0,0);
        var totalAll = (state.records||[]).length;
        var yearAll = (state.records||[]).filter(function(r){return new Date(r.date)>=yearStart;}).length;
        var monthAll = (state.records||[]).filter(function(r){return new Date(r.date)>=monthStart;}).length;
        var weekAll = (state.records||[]).filter(function(r){return new Date(r.date)>=weekStart;}).length;
        $('stTotal').textContent = recs.length;
        $('stYear').textContent = recs.filter(function(r){return new Date(r.date)>=yearStart;}).length;
        $('stMonth').textContent = recs.filter(function(r){return new Date(r.date)>=monthStart;}).length;
        $('stWeek').textContent = recs.filter(function(r){return new Date(r.date)>=weekStart;}).length;
        $('stAvgP').textContent = s.avg_pleasure || 0;
        $('stAvgD').innerHTML = (s.avg_duration || 0) + '<span class="unit">分</span>';
        $('stSex').textContent = recs.filter(function(r){return (r.category||'sex')==='sex';}).length;
        $('stMast').textContent = recs.filter(function(r){return (r.category||'sex')==='masturbation';}).length;
        $('stDream').textContent = recs.filter(function(r){return (r.category||'sex')==='dream';}).length;
        var maxDur=0,maxOrgasm=0;
        recs.forEach(function(r){if((r.duration||0)>maxDur)maxDur=r.duration;if((r.orgasm||0)>maxOrgasm)maxOrgasm=r.orgasm;});
        $('stMaxDur').innerHTML=maxDur+'<span class="unit">分</span>';
        $('stMaxOrgasm').textContent=maxOrgasm;
        var dates=recs.map(function(r){return r.date;}).filter(Boolean);
        var uniq=dates.filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
        var maxStreak=0,cur=1;
        for(var i=1;i<uniq.length;i++){var d1=new Date(uniq[i-1]),d2=new Date(uniq[i]);if((d2-d1)===86400000){cur++;}else{if(cur>maxStreak)maxStreak=cur;cur=1;}}
        if(cur>maxStreak)maxStreak=cur;
        $('stStreak').innerHTML=maxStreak+'<span class="unit">天</span>';
        var filteredMonthly = {};
        recs.forEach(function(r) { var m = (r.date||'').substring(0,7); if(m) filteredMonthly[m] = (filteredMonthly[m]||0)+1; });
        renderHeatmapYear(state.statsRange === 'all' ? (s.monthly||{}) : filteredMonthly);
        renderTrendChart(recs);
        renderFavorites(recs);
        renderDistributions(recs);
        renderPieCharts(recs);
        renderAwards(recs);
    }

    function renderTrendChart(recs) {
        var c=$('trendChart');
        if(!recs.length){c.innerHTML='<p class="empty-hint">暂无数据</p>';return;}
        var now=new Date(),months=[];
        for(var i=11;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),label:(d.getMonth()+1)+'月'});}
        var mc={};recs.forEach(function(r){var m=(r.date||'').substring(0,7);mc[m]=(mc[m]||0)+1;});
        var mx=Math.max.apply(null,months.map(function(m){return mc[m.key]||0;}).concat([1]));
        var h='<div class="trend-bars">';
        months.forEach(function(m){var v=mc[m.key]||0,p=Math.round(v/mx*100);h+='<div class="trend-col"><div class="trend-bar-wrap"><div class="trend-bar" style="height:'+p+'%" title="'+m.label+': '+v+'次"></div></div><div class="trend-label">'+m.label+'</div><div class="trend-count">'+v+'</div></div>';});
        h+='</div>';c.innerHTML=h;
    }
    function renderFavorites(recs) {
        var c=$('favGrid');
        if(!recs.length){c.innerHTML='<p class="empty-hint">暂无数据</p>';return;}
        var moodMap={happy:'开心',romantic:'浪漫',passionate:'激情',tired:'疲惫',calm:'平淡',wild:'狂野',tender:'温柔',frustrated:'失落',curious:'好奇',sober:'清醒',expect:'期待',satisfied:'满足',surprised:'惊喜',regret:'遗憾',wanting:'意犹未尽'};
        var catMap={sex:'做爱',masturbation:'自慰',dream:'春梦'};
        var initMap={me:'我',partner:'伴侣',both:'双方'};
        var contraMap={condom:'安全套',none:'无保护',pill:'避孕药',iud:'节育器',withdrawal:'体外',safe:'安全期',planb:'紧急避孕'};
        var sleepMap={good:'好',normal:'一般',bad:'差'};
        function getTop(arr,map){var m={};arr.forEach(function(v){if(v)m[v]=(m[v]||0)+1;});var keys=Object.keys(m).sort(function(a,b){return m[b]-m[a];});if(!keys.length)return null;var k=keys[0];return{raw:k,name:map?map[k]||k:k,count:m[k],total:arr.length,pct:Math.round(m[k]/arr.length*100)};}
        var fields=[
            {title:'类别',icon:'icon-heart',raw:[],map:catMap},
            {title:'地点',icon:'icon-map-pin',raw:[],map:null},
            {title:'心情',icon:'icon-mood-happy',raw:[],map:moodMap},
            {title:'体位',icon:'icon-bed',raw:[],map:null},
            {title:'方式',icon:'icon-zap',raw:[],map:null},
            {title:'射精',icon:'icon-droplet',raw:[],map:null},
            {title:'主动',icon:'icon-arrow-right',raw:[],map:initMap},
            {title:'避孕',icon:'icon-shield',raw:[],map:contraMap},
            {title:'玩具',icon:'icon-sparkle',raw:[],map:null}
        ];
        recs.forEach(function(r){
            if(r.category)fields[0].raw.push(r.category);
            if(r.location)fields[1].raw.push(r.location);
            if(r.mood)fields[2].raw.push(r.mood);
            if(r.position)r.position.split('、').forEach(function(v){fields[3].raw.push(v);});
            if(r.method)r.method.split('、').forEach(function(v){fields[4].raw.push(v);});
            if(r.ejaculation)r.ejaculation.split('、').forEach(function(v){fields[5].raw.push(v);});
            if(r.initiator)fields[6].raw.push(r.initiator);
            if(r.contraception)fields[7].raw.push(r.contraception);
            if(r.toys)r.toys.split('、').forEach(function(v){fields[8].raw.push(v);});
        });
        var h='';
        fields.forEach(function(f){
            var top=getTop(f.raw,f.map);
            if(!top)return;
            h+='<div class="fav-tag">';
            h+='<div class="fav-tag-head"><svg class="icon"><use href="#'+f.icon+'"/></svg> '+f.title+'</div>';
            h+='<div class="fav-tag-body">';
            h+='<span class="fav-tag-name">'+escHtml(top.name)+'</span>';
            h+='<span class="fav-tag-stat">'+top.count+'次 · '+top.pct+'%</span>';
            h+='</div></div>';
        });
        c.innerHTML=h||'<p class="empty-hint">暂无数据</p>';
    }
    function renderDistributions(recs) {
        var c=$('distGrid');
        if(!recs.length){c.innerHTML='<p class="empty-hint">暂无数据</p>';return;}
        var dn=['日','一','二','三','四','五','六'],dd=[0,0,0,0,0,0,0],hd={},durB={'≤10分':0,'11-30分':0,'31-60分':0,'>60分':0},plB={};
        for(var p=1;p<=10;p++)plB[p]=0;
        recs.forEach(function(r){if(r.date)dd[new Date(r.date).getDay()]++;if(r.time){var h=parseInt(r.time.substring(0,2));if(!isNaN(h)){var sl=h<6?'凌晨(0-6)':h<12?'上午(6-12)':h<18?'下午(12-18)':'晚上(18-24)';hd[sl]=(hd[sl]||0)+1;}}var dur=r.duration||0;if(dur<=10)durB['≤10分']++;else if(dur<=30)durB['11-30分']++;else if(dur<=60)durB['31-60分']++;else durB['>60分']++;var pl=r.pleasure||0;if(pl>=1&&pl<=10)plB[pl]++;});
        function bh(t,d,co){var mx=Math.max.apply(null,Object.values(d).map(function(v){return typeof v==='number'?v:0;}).concat([1]));var h='<div class="dist-card"><div class="dist-title">'+t+'</div><div class="dist-bars">';Object.keys(d).forEach(function(k){var v=d[k],p=Math.round(v/mx*100);h+='<div class="dist-row"><span class="dist-label">'+k+'</span><div class="dist-bar-bg"><div class="dist-bar-fill" style="width:'+p+'%;background:'+co+'"></div></div><span class="dist-count">'+v+'</span></div>';});h+='</div></div>';return h;}
        var dayD={};dn.forEach(function(n,i){dayD['周'+n]=dd[i];});
        c.innerHTML=bh('周几分布',dayD,'linear-gradient(90deg,#42a5f5,#1e88e5)')+bh('时间段分布',hd,'linear-gradient(90deg,#ab47bc,#7b1fa2)')+bh('时长分布',durB,'linear-gradient(90deg,#66bb6a,#2e7d32)')+bh('愉悦度分布',plB,'linear-gradient(90deg,#ffa726,#e65100)');
    }

    // ── 全项目分析饼图 ──
    function renderPieCharts(recs) {
        var c = $('pieGrid');
        if (!recs.length) { c.innerHTML = '<p class="empty-hint">暂无数据</p>'; return; }
        var moodMap = {happy:'开心',romantic:'浪漫',passionate:'激情',tired:'疲惫',calm:'平淡',wild:'狂野',tender:'温柔',frustrated:'失落',curious:'好奇',sober:'清醒',expect:'期待',satisfied:'满足',surprised:'惊喜',regret:'遗憾',wanting:'意犹未尽'};
        var catMap = {sex:'做爱',masturbation:'自慰',dream:'春梦'};
        var initMap = {me:'我',partner:'伴侣',both:'双方'};
        var contraMap = {condom:'安全套',none:'无保护',pill:'避孕药',iud:'节育器',withdrawal:'体外',safe:'安全期',planb:'紧急避孕'};
        var sleepMap = {good:'好',normal:'一般',poor:'差',bad:'差'};
        var coopMap = {1:'较差',2:'一般',3:'较好',4:'很好',5:'完美'};
        var libidoMap = {1:'很低',2:'较低',3:'一般',4:'较强',5:'很强'};
        var alcoholMap = {none:'无',light:'少量',medium:'中量',drunk:'醉酒'};
        function count(arr) { var m = {}; arr.forEach(function(v) { if (v) m[v] = (m[v] || 0) + 1; }); return m; }
        function toItems(m) { return Object.keys(m).sort(function(a,b){return m[b]-m[a];}).map(function(k){return {name:k,count:m[k]};}); }
        var fields = [
            {title:'类别',icon:'icon-heart',map:catMap,raw:[],color:'#e91e63'},
            {title:'地点',icon:'icon-map-pin',map:null,raw:[],color:'#66bb6a'},
            {title:'心情',icon:'icon-mood-happy',map:moodMap,raw:[],color:'#ffd93d'},
            {title:'体位',icon:'icon-bed',map:null,raw:[],color:'#ab47bc'},
            {title:'方式',icon:'icon-zap',map:null,raw:[],color:'#ffa726'},
            {title:'射精',icon:'icon-droplet',map:null,raw:[],color:'#42a5f5'},
            {title:'主动',icon:'icon-arrow-right',map:initMap,raw:[],color:'#66bb6a'},
            {title:'避孕',icon:'icon-shield',map:contraMap,raw:[],color:'#26a69a'},
            {title:'玩具',icon:'icon-sparkle',map:null,raw:[],color:'#ff6b9d'},
            {title:'配合度',icon:'icon-thumbs-up',map:coopMap,raw:[],color:'#7c4dff'},
            {title:'性欲',icon:'icon-flame',map:libidoMap,raw:[],color:'#ff5722'},
            {title:'酒精',icon:'icon-wine',map:alcoholMap,raw:[],color:'#ff6b9d'},
            {title:'睡眠',icon:'icon-moon',map:sleepMap,raw:[],color:'#42a5f5'}
        ];
        recs.forEach(function(r) {
            if (r.category) fields[0].raw.push(r.category);
            if (r.location) fields[1].raw.push(r.location);
            if (r.mood) fields[2].raw.push(r.mood);
            if (r.position) r.position.split('、').forEach(function(v){fields[3].raw.push(v);});
            if (r.method) r.method.split('、').forEach(function(v){fields[4].raw.push(v);});
            if (r.ejaculation) r.ejaculation.split('、').forEach(function(v){fields[5].raw.push(v);});
            if (r.initiator) fields[6].raw.push(r.initiator);
            if (r.contraception) fields[7].raw.push(r.contraception);
            if (r.toys) r.toys.split('、').forEach(function(v){fields[8].raw.push(v);});
            if (r.cooperation) fields[9].raw.push(String(r.cooperation));
            if (r.libido) fields[10].raw.push(String(r.libido));
            if (r.sleep_quality) fields[12].raw.push(r.sleep_quality);
            if (r.alcohol) fields[11].raw.push(r.alcohol);
        });
        var palette = ['#ff6b9d','#6b5ce7','#29b6f6','#ffa726','#66bb6a','#e91e63','#ab47bc','#42a5f5','#ef5350','#26a69a','#d4e157','#ff7043'];
        var h = '';
        fields.forEach(function(f) {
            var items = toItems(count(f.raw));
            if (!items.length) return;
            var total = items.reduce(function(s,it){return s+it.count;},0);
            var gradParts = [], cumPct = 0;
            items.forEach(function(it, idx) {
                var pct = Math.round(it.count / total * 100);
                var start = cumPct; cumPct += pct;
                gradParts.push(palette[idx % palette.length] + ' ' + start + '% ' + cumPct + '%');
            });
            if (cumPct < 100) gradParts.push('rgba(255,255,255,0.08) ' + cumPct + '% 100%');
            var grad = 'conic-gradient(' + gradParts.join(',') + ')';
            h += '<div class="pie-card">';
            h += '<div class="pie-head">' + f.title + '</div>';
            h += '<div class="pie-wrap"><div class="pie-chart" style="background:' + grad + '"></div><div class="pie-center-icon" style="color:' + f.color + '"><svg class="icon"><use href="#' + f.icon + '"/></svg></div></div>';
            h += '<div class="pie-legend">';
            items.forEach(function(it, idx) {
                var name = f.map ? (f.map[it.name] || it.name) : it.name;
                var pct = Math.round(it.count / total * 100);
                h += '<div class="pie-row"><span class="pie-dot" style="background:' + palette[idx % palette.length] + '"></span><span class="pie-name">' + escHtml(name) + '</span><span class="pie-val">' + it.count + '次 · ' + pct + '%</span></div>';
            });
            h += '</div></div>';
        });
        c.innerHTML = h || '<p class="empty-hint">暂无数据</p>';
    }

    // ── 最佳奖章 ──
    function renderAwards(recs) {
        var c = $('awardGrid');
        if (!recs.length) { c.innerHTML = '<p class="empty-hint">暂无数据</p>'; return; }
        var awards = [];
        // 最长时长
        var maxDurRec = recs.reduce(function(a, b) { return (a.duration || 0) > (b.duration || 0) ? a : b; });
        if (maxDurRec.duration) awards.push({ icon: 'icon-clock', title: '最持久', value: maxDurRec.duration + '分钟', date: maxDurRec.date });
        // 最多高潮
        var maxOrgRec = recs.reduce(function(a, b) { return (a.orgasm || 0) > (b.orgasm || 0) ? a : b; });
        if (maxOrgRec.orgasm) awards.push({ icon: 'icon-star', title: '最高潮', value: maxOrgRec.orgasm + '次', date: maxOrgRec.date });
        // 最高愉悦
        var maxPlRec = recs.reduce(function(a, b) { return (a.pleasure || 0) > (b.pleasure || 0) ? a : b; });
        if (maxPlRec.pleasure) awards.push({ icon: 'icon-heart', title: '最愉悦', value: maxPlRec.pleasure + '/10', date: maxPlRec.date });
        // 最长前戏
        var maxFpRec = recs.reduce(function(a, b) { return (a.foreplay || 0) > (b.foreplay || 0) ? a : b; });
        if (maxFpRec.foreplay) awards.push({ icon: 'icon-flame', title: '最长前戏', value: maxFpRec.foreplay + '分钟', date: maxFpRec.date });
        // 最投入（cooperation=5）
        var topCoopRecs = recs.filter(function(r) { return r.cooperation === 5; });
        if (topCoopRecs.length) awards.push({ icon: 'icon-zap', title: '最投入', value: topCoopRecs.length + '次', date: '' });
        // 最狂野（mood=wild）
        var wildRecs = recs.filter(function(r) { return r.mood === 'wild'; });
        if (wildRecs.length) awards.push({ icon: 'icon-mood-excited', title: '最狂野', value: wildRecs.length + '次', date: '' });
        // 最满足（mood=satisfied）
        var satRecs = recs.filter(function(r) { return r.mood === 'satisfied'; });
        if (satRecs.length) awards.push({ icon: 'icon-mood-satisfied', title: '最满足', value: satRecs.length + '次', date: '' });
        // 连续记录最长
        var dates = recs.map(function(r) { return r.date; }).filter(Boolean);
        var uniq = dates.filter(function(v, i, a) { return a.indexOf(v) === i; }).sort();
        var maxStreak = 0, cur = 1;
        for (var i = 1; i < uniq.length; i++) {
            var d1 = new Date(uniq[i-1]), d2 = new Date(uniq[i]);
            if ((d2 - d1) === 86400000) { cur++; } else { if (cur > maxStreak) maxStreak = cur; cur = 1; }
        }
        if (cur > maxStreak) maxStreak = cur;
        if (maxStreak >= 3) awards.push({ icon: 'icon-flame', title: '连续达人', value: maxStreak + '天', date: '' });

        if (!awards.length) { c.innerHTML = '<p class="empty-hint">继续记录解锁奖章</p>'; return; }
        var h = '';
        awards.forEach(function(a) {
            h += '<div class="award-card">';
            h += '<div class="award-icon"><svg class="icon"><use href="#' + a.icon + '"/></svg></div>';
            h += '<div class="award-info"><div class="award-title">' + a.title + '</div><div class="award-value">' + a.value + '</div>';
            if (a.date) h += '<div class="award-date">' + a.date + '</div>';
            h += '</div></div>';
        });
        c.innerHTML = h;
    }

    function renderHeatmapYear(monthly) {
        var container = $('heatmapYear');
        var today = new Date();
        var year = today.getFullYear();
        var range = state.statsRange;
        // Determine which months to highlight
        var highlightMonths = []; // 0-based month indices to highlight
        var hlYear = year;
        if (range === 'week' || range === 'month') {
            highlightMonths = [today.getMonth()];
        } else if (range === 'halfyear') {
            for (var i = 5; i >= 0; i--) {
                highlightMonths.push((today.getMonth() - i + 12) % 12);
            }
        } else if (range === 'prev') {
            hlYear = parseInt(state.statsYear) || (year - 1);
            highlightMonths = [0,1,2,3,4,5,6,7,8,9,10,11];
        }
        // 'all' and 'year': no highlight (show all equally)

        var html = '<div class="heatmap-months">';
        var monthNums = ['1','2','3','4','5','6','7','8','9','10','11','12'];
        var monthSuf = '\u6708';
        for (var m = 0; m < 12; m++) {
            var mYear = (range === 'prev') ? hlYear : year;
            var monthStr = String(mYear) + '-' + String(m+1).padStart(2,'0');
            var count = monthly[monthStr] || 0;
            var mName = monthNums[m] + monthSuf;
            var isHL = highlightMonths.indexOf(m) !== -1;
            var hlCls = (range !== 'all' && range !== 'year') ? (isHL ? ' hl-active' : ' hl-dim') : '';
            html += '<div class="heatmap-month-block' + hlCls + '" title="' + mName + ': ' + count + '\u6B21">' +
                '<div class="month-label">' + mName + '</div>' +
                '<div class="heatmap-cells">' + heatmapMonthCells(mYear, m) + '</div>' +
                '<div class="month-count">' + count + '\u6B21</div>' +
            '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
    }



    function heatmapMonthCells(year, month) {
        var firstDay = new Date(year, month, 1);
        var startPad = (firstDay.getDay() + 6) % 7; // 周一=0
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var html = '';

        for (var i = 0; i < startPad; i++) {
            html += '<div class="h-cell empty"></div>';
        }

        var today = new Date();
        for (var d = 1; d <= daysInMonth; d++) {
            var ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
            var isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            // 类别判定：该天是否有做爱/自慰
            var cats = state.records
                .filter(function(r){ return r.date === ds; })
                .map(function(r){ return r.category || 'sex'; });
            var hasSex = cats.indexOf('sex') !== -1;
            var hasMast = cats.indexOf('masturbation') !== -1;
            var hasDream = cats.indexOf('dream') !== -1;
            var count = cats.length;
            var cat = hasSex ? 'sex' : (hasMast ? 'mast' : (hasDream ? 'dream' : ''));
            var catLabel = {sex:'做爱',masturbation:'自慰',dream:'春梦'}[cat] || '';
            var cls = count === 0 ? 'level-0' : count <= 3 ? 'level-1' : count <= 8 ? 'level-2' : 'level-3';
            if (cat) cls = 'cat-' + cat;
            html += '<div class="h-cell '+cls+(isToday?' today':'')+'" title="'+ds+(cat?(' · '+catLabel):'')+'"></div>';
        }

        return html;
    }

    // ── 周期管理 ──
    function _currentPhase() {
        var periods = state.periods;
        var st = state.settings;
        if (!periods.length) return { phase: '未知', cls: 'phase-unknown', is_safe: false };
        var last = periods.reduce(function(a, b) {
            return (b.start_date || '') > (a.start_date || '') ? b : a;
        });
        var cl = st.cycle_length || 28;
        var pd = st.period_length || 5;
        var sd = st.safe_period_days || 7;
        var today = new Date();
        try {
            var lastStart = new Date(last.start_date);
            var daysSince = Math.floor((today - lastStart) / 86400000);
            if (daysSince < 0) return { phase: '未知', cls: 'phase-unknown', is_safe: false };
            var cd = daysSince % cl;
            if (cd < pd) return { phase: '经期', cls: 'phase-period', is_safe: false };
            if (cd >= cl - sd) return { phase: '安全期', cls: 'phase-safe', is_safe: true };
            return { phase: '易孕期', cls: 'phase-fertile', is_safe: false };
        } catch(e) {
            return { phase: '未知', cls: 'phase-unknown', is_safe: false };
        }
    }

    function renderPeriods() {
        var ph = _currentPhase();
        $('predNextPeriod').textContent = state.stats.next_period || '—';
        $('predSafeStatus').innerHTML = '<span class="safe-badge ' + ph.cls + '">' +
            '<span class="status-dot ' + (ph.is_safe ? 'safe' : 'danger') + '"></span>' + ph.phase + '</span>';

        var periods = state.periods.slice().sort(function(a,b) {
            return (b.start_date||'') < (a.start_date||'') ? -1 : 1;
        });

        var list = $('periodList');
        if (!periods.length) {
            list.innerHTML = '<p class="empty-hint">暂无经期记录</p>';
            return;
        }

        // 按年月分组
        var monthMap = {};
        var monthOrder = [];
        periods.forEach(function(p) {
            var ym = (p.start_date||'').substring(0,7) || '未知';
            if (!monthMap[ym]) { monthMap[ym] = []; monthOrder.push(ym); }
            monthMap[ym].push(p);
        });

        var html = '';
        monthOrder.forEach(function(ym) {
            var items = monthMap[ym];
            var y = ym.substring(0,4);
            var m = ym.substring(5,7);
            html += '<div class="month-group">' +
                '<div class="month-header" onclick="toggleGroup(this)">' +
                    '<span>'+y+'年'+parseInt(m)+'月 <span class="count">'+items.length+'条</span></span>' +
                    '<span class="arrow">▶</span>' +
                '</div>' +
                '<div class="month-body">';

            items.forEach(function(p) {
                var duration = '';
                if (p.end_date && p.start_date) {
                    var days = Math.round((new Date(p.end_date) - new Date(p.start_date)) / 86400000) + 1;
                    duration = '（持续' + days + '天）';
                }
                html += '<div class="period-item ' + ph.cls + '" data-id="'+p.id+'">' +
                    '<div class="period-info">' +
                        '<span class="period-date"><svg class="icon"><use href="#icon-droplet"/></svg> '+p.start_date + (p.end_date ? ' ~ '+p.end_date : '') + '</span>' +
                        '<span class="period-phase-badge ' + ph.cls + '">' + ph.phase + '</span>' +
                        '<span class="period-dur">'+duration+'</span>' +
                        (p.notes ? '<span class="period-notes">'+escHtml(p.notes)+'</span>' : '') +
                    '</div>' +
                    '<button class="btn-del-period" data-id="'+p.id+'">删除</button>' +
                '</div>';
            });
            html += '</div></div>';
        });
        list.innerHTML = html;
    }

    function updateSafeBadge() {
        var s = state.stats;
        var isSafe = s && s.is_safe_period;
        $('safeStatusIcon').innerHTML = '<span class="status-dot ' + (isSafe ? 'safe' : 'danger') + '"></span>';
        $('safeStatusText').textContent = isSafe ? '安全期' : (s && s.total_count > 0 ? '易孕期' : '未知');
        $('btnSafeBadge').className = 'btn-safe-badge ' + (isSafe ? 'safe' : 'fertile');
    }

    // ── 设置表单 ──
    function updateSettingsForm() {
        var s = state.settings;
        $('cycleLength').value = s.cycle_length || 28;
        $('periodLength').value = s.period_length || 5;
        $('safePeriodDays').value = s.safe_period_days || 7;
        $('ovulationBuffer').value = s.ovulation_buffer_days || 5;
    }

    // ── 筛选选项 ──
    function buildFilterOptions() {
        var months = {};
        var locations = {};
        state.records.forEach(function(r) {
            var m = (r.date||'').substring(0,7);
            if (m) months[m] = true;
            if (r.location) locations[r.location] = true;
        });
        var keys = Object.keys(months).sort().reverse();
        var html = '<option value="">全部月份</option>';
        keys.forEach(function(m) {
            html += '<option value="'+m+'">'+m+'</option>';
        });
        $('filterMonth').innerHTML = html;
    }

    // ── 模态框 ──
    function openAddRecordModal(dateStr) {
        state.editingRecordId = null;
        $('modalRecordTitle').textContent = '添加记录';
        $('recDate').value = dateStr || fmtDate(new Date());
        $('recTime').value = fmtTime(new Date());
        updateDatetimeBtns();
        setMoodValue('recCategory', 'sex');
        setMoodValue('moodGrid', 'happy');
        setMoodValue('locationGrid', '卧室');
        setDurationValue(20);
        setMoodValue('foreplayGrid', '0');
        setMoodValue('initiatorGrid', '双方主动');
        setMoodValue('recLibido', '3');
        setMoodValue('recOrgasm', '2');
        setMoodValue('recContraception', 'withdrawal');
        setMoodValue('recCooperation', '3');
        setMoodValue('recSleepQuality', 'normal');
        setMoodValue('recAlcohol', 'none');
        ['positionGrid','methodGrid','cumshotGrid','toyGrid'].forEach(function(cid) {
            var c = $(cid);
            if (c) c.querySelectorAll('.tag-btn.multi').forEach(function(b){ b.classList.remove('active'); });
        });
        setMultiTagValues('positionGrid', '传教士');
        setMultiTagValues('methodGrid', '阴道性交');
        setMultiTagValues('cumshotGrid', '阴道内');
        setMultiTagValues('toyGrid', '跳蛋');
        $('recNotes').value = '';
        setRating(8);
        showModal('modalAddRecord');
    }

    function openEditRecordModal(id) {
        var rec = state.records.find(function(r){ return r.id === id; });
        if (!rec) return;
        state.editingRecordId = id;
        $('modalRecordTitle').textContent = '编辑记录';
        $('recDate').value = rec.date || '';
        $('recTime').value = rec.time || '22:00';
        updateDatetimeBtns();
        setMoodValue('recCategory', rec.category || 'sex');
        setMoodValue('moodGrid', rec.mood || 'happy');
        setMoodValue('locationGrid', rec.location || '家');
        setDurationValue(rec.duration || 20);
        setMoodValue('foreplayGrid', String(rec.foreplay || 10));
        setMoodValue('initiatorGrid', rec.initiator || '');
        setMoodValue('recLibido', String(rec.libido || 3));
        setMoodValue('recOrgasm', String(rec.orgasm || 2));
        setMoodValue('recContraception', rec.contraception || 'condom');
        setMoodValue('recCooperation', String(rec.cooperation || 3));
        setMoodValue('recSleepQuality', rec.sleep_quality || 'normal');
        setMoodValue('recAlcohol', rec.alcohol || 'none');
        setMultiTagValues('positionGrid', rec.position || '');
        setMultiTagValues('methodGrid', rec.method || '');
        setMultiTagValues('cumshotGrid', rec.ejaculation || '');
        setMultiTagValues('toyGrid', rec.toy_detail || '');
        $('recNotes').value = rec.notes || '';
        setRating(parseInt(rec.pleasure) || 5);
        showModal('modalAddRecord');
    }

    function openViewRecordModal(id) {
        var rec = state.records.find(function(r){ return r.id === id; });
        if (!rec) return;
        state.viewRecordId = id;
        $('viewRecordTitle').textContent = rec.date + ' 记录详情';
        var pleasureEmo = ratingEmoji(rec.pleasure);
        var moodText = {happy:'开心',romantic:'浪漫',passionate:'激情',tired:'疲惫',calm:'平淡',wild:'狂野',tender:'温柔',frustrated:'失落',curious:'好奇',sober:'清醒',expect:'期待',satisfied:'满足',surprised:'惊喜',regret:'遗憾',wanting:'意犹未尽'}[rec.mood]||'';
        var libidoText = {1:'很低',2:'一般',3:'正常',4:'强烈',5:'爆炸'}[String(rec.libido)]||'正常';
        var alcoholText = {none:'无',light:'少量',medium:'中量',drunk:'醉酒'}[rec.alcohol]||'无';
        var contraceptionText = {condom:'安全套',none:'无保护',pill:'短效避孕药',iud:'宫内节育器',withdrawal:'体外射精',safe:'安全期',planb:'紧急避孕'}[rec.contraception]||'安全套';
        var cumshotText = rec.ejaculation ? rec.ejaculation.split('、').map(function(e){
            return e;
        }).join('、') : '—未发生';
        var sleepQualityText = {bad:'很差',poor:'较差',normal:'一般',good:'良好',great:'非常好'}[rec.sleep_quality]||'一般';
        var alcoholText = {none:'无',light:'少量',medium:'中量',drunk:'醉酒'}[rec.alcohol]||'无';
        var cooperationText = {1:'抗拒',2:'勉强',3:'配合',4:'积极',5:'非常投入'}[String(rec.cooperation)]||'配合';
        var catText = {sex:'做爱',masturbation:'自慰',dream:'春梦'}[rec.category||'sex'] || '做爱';
        var posHtml = rec.position ? rec.position.split('、').map(function(p){ return '<span class="vd-tag">'+escHtml(p)+'</span>'; }).join('') : '-';
        var methodHtml = rec.method ? rec.method.split('、').map(function(m){ return '<span class="vd-tag vd-tag-method">'+escHtml(m)+'</span>'; }).join('') : '-';
        var ejHtml = rec.ejaculation ? rec.ejaculation.split('、').map(function(e){ return '<span class="vd-tag vd-tag-ej">'+escHtml(e)+'</span>'; }).join('') : '-';
        var toyHtml = rec.toy_detail ? rec.toy_detail.split('、').map(function(t){ return '<span class="vd-tag vd-tag-toy">'+escHtml(t)+'</span>'; }).join('') : '-';
        $('viewRecordBody').innerHTML = '<div class="view-detail-grid">' +
            '<div class="vd-item"><span class="vd-label">类别</span><span class="vd-val">'+catText+'</span></div>' +
            // 1. 时间
            '<div class="vd-item"><span class="vd-label">日期</span><span class="vd-val">'+rec.date+' '+(rec.time||'')+'</span></div>' +
            // 2. 持续时间
            '<div class="vd-item"><span class="vd-label">总时长</span><span class="vd-val">'+(rec.duration||'-')+'分钟</span></div>' +
            // 3. 体位
            '<div class="vd-item full"><span class="vd-label">体位</span><div class="vd-tags-wrap">'+posHtml+'</div></div>' +
            // 4. 避孕措施
            '<div class="vd-item"><span class="vd-label">避孕</span><span class="vd-val">'+contraceptionText+'</span></div>' +
            // 5. 做爱方式
            '<div class="vd-item full"><span class="vd-label">做爱方式</span><div class="vd-tags-wrap">'+methodHtml+'</div></div>' +
            // 6. 高潮次数
            '<div class="vd-item"><span class="vd-label">高潮</span><span class="vd-val">'+(rec.orgasm||0)+'次</span></div>' +
            // 7. 前戏时长
            '<div class="vd-item"><span class="vd-label">前戏</span><span class="vd-val">'+(rec.foreplay||0)+'分钟</span></div>' +
            // 8. 谁主动
            '<div class="vd-item"><span class="vd-label">主动方</span><span class="vd-val">'+(rec.initiator||'-')+'</span></div>' +
            // 9. 伴侣配合度
            '<div class="vd-item"><span class="vd-label">配合度</span><span class="vd-val">'+cooperationText+'</span></div>' +
            // 10. 心情
            '<div class="vd-item"><span class="vd-label">心情</span><span class="vd-val">'+moodText+'</span></div>' +
            '<div class="vd-item"><span class="vd-label">性欲</span><span class="vd-val">'+libidoText+'</span></div>' +
            // 11. 近期睡眠质量
            '<div class="vd-item"><span class="vd-label">睡眠</span><span class="vd-val">'+sleepQualityText+'</span></div>' +
            '<div class="vd-item"><span class="vd-label">酒精</span><span class="vd-val">'+alcoholText+'</span></div>' +
            // 12. 愉悦程度
            '<div class="vd-item"><span class="vd-label">愉悦</span><span class="vd-val vd-pleasure"><svg class="icon"><use href="#icon-star"/></svg> '+rec.pleasure+'/10</span></div>' +
            '<div class="vd-item full"><span class="vd-label">射精位置</span><div class="vd-tags-wrap">'+ejHtml+'</div></div>' +
            (rec.toy_detail&&toyHtml!=='-'?'<div class="vd-item full"><span class="vd-label">情趣用品</span><div class="vd-tags-wrap">'+toyHtml+'</div></div>':'')+
            '<div class="vd-item"><span class="vd-label">地点</span><span class="vd-val">'+escHtml(rec.location||'-')+'</span></div>' +
            (rec.notes?'<div class="vd-item full"><span class="vd-label">备注</span><span class="vd-val">'+escHtml(rec.notes)+'</span></div>':'')+
        '</div>';
        showModal('modalViewRecord');
    }

    function openDayDetailModal(dateStr, ids) {
        var recs = ids.map(function(id) {
            return state.records.find(function(r) { return r.id === id; });
        }).filter(Boolean);
        if (!recs.length) {
            openAddRecordModal(dateStr);
            return;
        }
        state.dayDetailDate = dateStr;
        $('dayDetailTitle').textContent = dateStr + ' 的记录 (' + recs.length + '条)';

        var moodMap = {happy:'开心',romantic:'浪漫',passionate:'激情',tired:'疲惫',calm:'平淡',wild:'狂野',tender:'温柔',frustrated:'失落',curious:'好奇',sober:'清醒',expect:'期待',satisfied:'满足',surprised:'惊喜',regret:'遗憾',wanting:'意犹未尽'};
        var catMap = {sex:'做爱',masturbation:'自慰'};
        var ratingEmojis = ['','😶','😐','🙂','😊','😄','😁','🤩','🔥','💯','⭐'];

        var html = '<div class="day-detail-list">';
        recs.forEach(function(rec) {
            var cat = rec.category || 'sex';
            var catLabel = catMap[cat] || '做爱';
            var catClass = cat === 'masturbation' ? 'dd-cat-mast' : 'dd-cat-sex';
            var moodLabel = moodMap[rec.mood] || '';
            var pleasure = parseInt(rec.pleasure) || 5;
            var pEmoji = ratingEmojis[pleasure] || '😄';
            var duration = rec.duration || 0;
            var timeStr = rec.time || '--:--';
            var location = rec.location || '';
            var notes = rec.notes || '';
            var position = rec.position || '';
            var method = rec.method || '';

            html += '<div class="dd-card">' +
                '<div class="dd-card-header">' +
                    '<span class="dd-time">' + escHtml(timeStr) + '</span>' +
                    '<span class="dd-badge ' + catClass + '">' + catLabel + '</span>' +
                    '<span class="dd-pleasure">' + pEmoji + ' ' + pleasure + '/10</span>' +
                '</div>' +
                '<div class="dd-card-body">' +
                    '<div class="dd-info-row">' +
                        (duration ? '<span class="dd-info"><svg class="icon icon-amber"><use href="#icon-clock"/></svg> ' + duration + '分钟</span>' : '') +
                        (location ? '<span class="dd-info"><svg class="icon icon-teal"><use href="#icon-map-pin"/></svg> ' + escHtml(location) + '</span>' : '') +
                        (moodLabel ? '<span class="dd-info"><svg class="icon icon-mood-romantic"><use href="#icon-thought"/></svg> ' + moodLabel + '</span>' : '') +
                    '</div>' +
                    (position ? '<div class="dd-tags"><svg class="icon icon-rose"><use href="#icon-activity"/></svg> ' +
                        position.split('、').map(function(p){ return '<span class="dd-tag dd-tag-pos">' + escHtml(p) + '</span>'; }).join('') + '</div>' : '') +
                    (method ? '<div class="dd-tags"><svg class="icon icon-purple"><use href="#icon-heart"/></svg> ' +
                        method.split('、').map(function(m){ return '<span class="dd-tag dd-tag-method">' + escHtml(m) + '</span>'; }).join('') + '</div>' : '') +
                    (notes ? '<div class="dd-notes">' + escHtml(notes) + '</div>' : '') +
                '</div>' +
                '<div class="dd-card-footer">' +
                    '<button class="dd-btn dd-btn-view" data-id="' + rec.id + '"><svg class="icon"><use href="#icon-eye"/></svg> 详情</button>' +
                    '<button class="dd-btn dd-btn-edit" data-id="' + rec.id + '"><svg class="icon"><use href="#icon-edit"/></svg> 编辑</button>' +
                    '<button class="dd-btn dd-btn-del" data-id="' + rec.id + '"><svg class="icon"><use href="#icon-trash"/></svg> 删除</button>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';
        $('dayDetailBody').innerHTML = html;
        showModal('modalDayDetail');
    }

    function showModal(id) {
        var m = $(id);
        m.classList.add('active');
        m.classList.remove('closing');
        document.body.classList.add('modal-open');
    }

    function hideModal(id) {
        var m = $(id);
        m.classList.add('closing');
        setTimeout(function(){
            m.classList.remove('active','closing');
            // 只有没有其他打开的弹窗时才解锁
            if (!document.querySelector('.modal.active')) {
                document.body.classList.remove('modal-open');
            }
        }, 200);
    }

    function setRating(val) {
        document.querySelectorAll('.rating-btn').forEach(function(b) {
            b.classList.toggle('active', parseInt(b.dataset.val) === val);
        });
        $('ratingDisplayVal').textContent = val;
    }

    // 读取单选 mood-grid 的值（直接读隐藏 input，更可靠）
    var _hiddenMap = {
        moodGrid: 'recMood',
        locationGrid: 'recLocation',
        durationGrid: 'recDuration',
        foreplayGrid: 'recForeplay',
        initiatorGrid: 'recInitiator',
        recLibido: 'recLibidoVal',
        recOrgasm: 'recOrgasmVal',
        recContraception: 'recContraceptionVal',
        recCooperation: 'recCooperationVal',
        recSleepQuality: 'recSleepQualityVal',
        recCategory: 'recCategoryVal',
        recAlcohol: 'recAlcoholVal',
        cumshotGrid: 'recCumshot',
    };

    function getMoodValue(gridId) {
        var hiddenId = _hiddenMap[gridId];
        if (!hiddenId) return null;
        var el = $(hiddenId);
        return el ? el.value : null;
    }

    function setMoodValue(gridId, val) {
        var hiddenId = _hiddenMap[gridId];
        if (!hiddenId) return;
        var el = $(hiddenId);
        if (el) el.value = val;
        var grid = $(gridId);
        if (!grid) return;
        grid.querySelectorAll('.mood-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.val === val);
        });
    }

    function getMultiTagValues(containerId) {
        var container = $(containerId);
        if (!container) return '';
        var active = container.querySelectorAll('.tag-btn.multi.active');
        var vals = [];
        active.forEach(function(b) { vals.push(b.dataset.val); });
        return vals.join('、');
    }

    function setMultiTagValues(containerId, valuesStr) {
        var container = $(containerId);
        if (!container) return;
        var values = valuesStr ? valuesStr.split('、') : [];
        container.querySelectorAll('.tag-btn.multi').forEach(function(b) {
            b.classList.toggle('active', values.indexOf(b.dataset.val) !== -1);
        });
    }

    function fmtDate(d) {
        return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }

    function fmtTime(d) {
        return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    }

    function fmtDateCN(dateStr) {
        if (!dateStr) return '请选择日期';
        var parts = dateStr.split('-');
        return parts[0]+'年'+parseInt(parts[1])+'月'+parseInt(parts[2])+'日';
    }

    function updateDatetimeBtns() {
        var dateText = $('recDateText');
        var timeText = $('recTimeText');
        if (dateText) dateText.textContent = fmtDateCN($('recDate').value);
        if (timeText) timeText.textContent = $('recTime').value || '22:00';
    }

    function initDatetimeBtns() {
        // Custom pickers are wired via event delegation (see global click handler)
        // Nothing to do here — kept as no-op for compatibility
    }

    // ── CRUD ──
    function doSaveRecord() {
        var positions = getMultiTagValues('positionGrid');
        var methods = getMultiTagValues('methodGrid');
        var ejaculations = getMultiTagValues('cumshotGrid');
        var toys = getMultiTagValues('toyGrid');

        var rec = {
            date: $('recDate').value,
            time: $('recTime').value,
            category: getMoodValue('recCategory') || 'sex',
            location: getMoodValue('locationGrid') || '家',
            duration: parseInt(getMoodValue('durationGrid')) || 20,
            foreplay: parseInt(getMoodValue('foreplayGrid')) || 10,
            position: positions,
            method: methods,
            ejaculation: ejaculations,
            pleasure: parseInt(document.querySelector('.rating-btn.active').dataset.val) || 5,
            sex_toy: toys.length > 0,
            toy_detail: toys,
            mood: getMoodValue('moodGrid') || 'happy',
            libido: parseInt(getMoodValue('recLibido')) || 3,
            orgasm: parseInt(getMoodValue('recOrgasm')) || 2,
            initiator: getMoodValue('initiatorGrid') || '',
            contraception: getMoodValue('recContraception') || 'condom',
            cooperation: parseInt(getMoodValue('recCooperation')) || 3,
            sleep_quality: getMoodValue('recSleepQuality') || 'normal',
            alcohol: getMoodValue('recAlcohol') || 'none',
            notes: $('recNotes').value,
        };

        if (!rec.date) {
            alert('请选择日期');
            return;
        }
        if (!rec.position && !rec.method) {
            alert('请至少选择一个体位或做爱方式');
            return;
        }

        var promise;
        if (state.editingRecordId) {
            promise = apiPost('delete_record', {record_id: state.editingRecordId}).catch(function(){}).then(function() {
                rec.id = state.editingRecordId;
                rec.created_at = new Date().toISOString();
                return apiPost('add_record', {record: rec});
            });
        } else {
            promise = apiPost('add_record', {record: rec});
        }

        promise.then(function() {
            hideModal('modalAddRecord');
            loadAll();
        }).catch(function(e) {
            alert('保存失败: ' + e.message);
        });
    }

    function doDeleteRecord(id) {
        if (!confirm('确定删除这条记录？')) return;
        apiPost('delete_record', {record_id: id}).then(function() {
            hideModal('modalViewRecord');
            loadAll();
        }).catch(function(e) {
            alert('删除失败: ' + e.message);
        });
    }

    function doSaveSettings() {
        var settings = {
            cycle_length: Math.max(20, Math.min(45, parseInt($('cycleLength').value))) || 28,
            period_length: Math.max(2, Math.min(10, parseInt($('periodLength').value))) || 5,
            safe_period_days: Math.max(3, Math.min(14, parseInt($('safePeriodDays').value))) || 7,
            ovulation_buffer_days: Math.max(2, Math.min(10, parseInt($('ovulationBuffer').value))) || 5,
        };
        apiPost('update_settings', {settings: settings}).then(function() {
            state.settings = settings;
            alert('设置已保存');
            loadAll();
        }).catch(function(e) {
            alert('保存失败: ' + e.message);
        });
    }

    // ── 主题 ──
    function applyTheme(t) {
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('intimacy_theme', t); } catch(e){}
        document.querySelectorAll('.theme-btn').forEach(function(b){
            b.classList.toggle('active', b.dataset.theme === t);
        });
    }

    // ── 全局事件委托 ──
    // ==================================================
    // -- Custom Date/Time Picker --
    // ==================================================
    var cpYear, cpMonth, cpSelectedDate;
    var tpHour = 0, tpMinute = 0;

    function openDatePicker() {
        var dateInput;
        if (state.pickerTarget === 'period-start') {
            dateInput = document.getElementById('periodStartDate');
        } else if (state.pickerTarget === 'period-end') {
            dateInput = document.getElementById('periodEndDate');
        } else {
            dateInput = document.getElementById('recDate');
        }
        var currentVal = dateInput.value || fmtDate(new Date());
        var parts = currentVal.split('-');
        cpYear = parseInt(parts[0]) || new Date().getFullYear();
        cpMonth = parseInt(parts[1]) - 1 || new Date().getMonth();
        cpSelectedDate = currentVal;
        renderDatePicker();
        document.getElementById('datePicker').classList.add('active');
    }

    function closeDatePicker() {
        document.getElementById('datePicker').classList.remove('active');
    }

    function renderDatePicker() {
        document.getElementById('cpYearLabel').textContent = cpYear + '年';
        var monthsHtml = '';
        var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
        var selMonth = cpSelectedDate ? parseInt(cpSelectedDate.split('-')[1]) - 1 : -1;
        var selYear = cpSelectedDate ? parseInt(cpSelectedDate.split('-')[0]) : -1;
        for (var i = 0; i < 12; i++) {
            var active = (cpYear === selYear && i === selMonth) ? ' active' : '';
            monthsHtml += '<button class="cp-month-btn' + active + '" data-month="' + i + '">' + monthNames[i] + '</button>';
        }
        document.getElementById('cpMonths').innerHTML = monthsHtml;
        renderDaysGrid();
        document.getElementById('cpMonths').querySelectorAll('.cp-month-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                cpMonth = parseInt(this.dataset.month);
                renderDatePicker();
            });
        });
    }

    function renderDaysGrid() {
        var firstDay = new Date(cpYear, cpMonth, 1).getDay();
        var daysInMonth = new Date(cpYear, cpMonth + 1, 0).getDate();
        var daysInPrev = new Date(cpYear, cpMonth, 0).getDate();
        var today = fmtDate(new Date());
        var html = '';
        for (var i = firstDay - 1; i >= 0; i--) {
            html += '<div class="cp-day other-month">' + (daysInPrev - i) + '</div>';
        }
        for (var d = 1; d <= daysInMonth; d++) {
            var dateStr = cpYear + '-' + String(cpMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            var classes = 'cp-day';
            if (dateStr === cpSelectedDate) classes += ' selected';
            if (dateStr === today) classes += ' today';
            html += '<div class="' + classes + '" data-date="' + dateStr + '">' + d + '</div>';
        }
        var totalCells = firstDay + daysInMonth;
        var remaining = (7 - (totalCells % 7)) % 7;
        for (var d = 1; d <= remaining; d++) {
            html += '<div class="cp-day other-month">' + d + '</div>';
        }
        document.getElementById('cpDays').innerHTML = html;
        document.getElementById('cpDays').querySelectorAll('.cp-day').forEach(function(el) {
            el.addEventListener('click', function() {
                if (this.dataset.date) {
                    cpSelectedDate = this.dataset.date;
                    renderDatePicker();
                }
            });
        });
    }

    // Date picker nav + overlay close
    document.getElementById('datePicker').addEventListener('click', function(e) {
        if (e.target.id === 'cpPrevYear') { cpYear--; renderDatePicker(); }
        if (e.target.id === 'cpNextYear') { cpYear++; renderDatePicker(); }
        if (e.target === this) closeDatePicker();
    });

    // -- Time Picker --
    function openTimePicker() {
        var timeInput;
        if (state.pickerTarget === 'period-start') {
            timeInput = document.getElementById('periodStartTime');
        } else if (state.pickerTarget === 'period-end') {
            timeInput = document.getElementById('periodEndTime');
        } else {
            timeInput = document.getElementById('recTime');
        }
        var val = timeInput.value || '00:00';
        var parts = val.split(':');
        tpHour = parseInt(parts[0]) || 0;
        tpMinute = parseInt(parts[1]) || 0;
        renderTimeWheel();
        document.getElementById('timePicker').classList.add('active');
    }

    function closeTimePicker() {
        document.getElementById('timePicker').classList.remove('active');
    }

    function renderTimeWheel() {
        renderWheelItems('tpHourWheel', 24, tpHour, function(v) { tpHour = v; });
        renderWheelItems('tpMinuteWheel', 60, tpMinute, function(v) { tpMinute = v; });
    }

    function renderWheelItems(wheelId, count, selected, onChange) {
        var wheel = document.getElementById(wheelId);
        var html = '';
        for (var i = 0; i < count; i++) {
            var label = String(i).padStart(2, '0');
            html += '<div class="tp-wheel-item' + (i === selected ? ' selected' : '') + '" data-val="' + i + '">' + label + '</div>';
        }
        wheel.innerHTML = html;
        setTimeout(function() {
            var item = wheel.querySelector('.selected');
            if (item) wheel.scrollTop = item.offsetTop - (wheel.clientHeight / 2 - 22);
        }, 10);
        wheel.querySelectorAll('.tp-wheel-item').forEach(function(item) {
            item.addEventListener('click', function() {
                wheel.querySelectorAll('.tp-wheel-item').forEach(function(i){ i.classList.remove('selected'); });
                this.classList.add('selected');
                onChange(parseInt(this.dataset.val));
                wheel.scrollTop = this.offsetTop - (wheel.clientHeight / 2 - 22);
            });
        });
        bindWheelDrag(wheel, onChange);
        bindMouseDrag(wheel, onChange);
    }

    function bindWheelDrag(wheel, onChange) {
        var startY = 0, startScroll = 0, isDragging = false;
        wheel.addEventListener('touchstart', function(e) {
            isDragging = true; startY = e.touches[0].clientY; startScroll = wheel.scrollTop;
        }, { passive: true });
        wheel.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            wheel.scrollTop = startScroll - (e.touches[0].clientY - startY);
        }, { passive: true });
        wheel.addEventListener('touchend', function() {
            if (!isDragging) return; isDragging = false; snapWheel(wheel, onChange);
        });
    }

    function bindMouseDrag(wheel, onChange) {
        var startY = 0, startScroll = 0, isDragging = false;
        wheel.addEventListener('mousedown', function(e) {
            isDragging = true; startY = e.clientY; startScroll = wheel.scrollTop; e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            wheel.scrollTop = startScroll - (e.clientY - startY);
        });
        document.addEventListener('mouseup', function() {
            if (!isDragging) return; isDragging = false; snapWheel(wheel, onChange);
        });
    }

    function snapWheel(wheel, onChange) {
        var items = wheel.querySelectorAll('.tp-wheel-item');
        if (!items.length) return;
        var center = wheel.scrollTop + wheel.clientHeight / 2;
        var closest = null, minDist = Infinity;
        items.forEach(function(item) {
            var itemCenter = item.offsetTop + item.clientHeight / 2;
            var dist = Math.abs(itemCenter - center);
            if (dist < minDist) { minDist = dist; closest = item; }
        });
        if (closest) {
            items.forEach(function(i){ i.classList.remove('selected'); });
            closest.classList.add('selected');
            onChange(parseInt(closest.dataset.val));
            wheel.scrollTop = closest.offsetTop - (wheel.clientHeight / 2 - 22);
        }
    }

    // Time picker overlay close
    document.getElementById('timePicker').addEventListener('click', function(e) {
        if (e.target === this) closeTimePicker();
    });

    // -- Picker confirm/cancel handlers --
    document.addEventListener('click', function(e) {
        var t = e.target;
        // Date picker OK
        if (t.closest('#datePicker') && t.classList.contains('cp-ok')) {
            if (!cpSelectedDate) cpSelectedDate = fmtDate(new Date());
            if (state.pickerTarget === 'period-start') {
                document.getElementById('periodStartDate').value = cpSelectedDate;
                document.getElementById('periodStartDateText').textContent = cpSelectedDate;
            } else if (state.pickerTarget === 'period-end') {
                document.getElementById('periodEndDate').value = cpSelectedDate;
                document.getElementById('periodEndDateText').textContent = cpSelectedDate;
            } else {
                document.getElementById('recDate').value = cpSelectedDate;
            }
            updateDatetimeBtns();
            state.pickerTarget = 'record';
            closeDatePicker();
        }
        // Date picker cancel
        if (t.closest('#datePicker') && t.classList.contains('cp-cancel')) closeDatePicker();
        // Date picker today
        if (t.closest('#datePicker') && t.classList.contains('cp-today')) {
            cpSelectedDate = fmtDate(new Date());
            cpYear = new Date().getFullYear();
            cpMonth = new Date().getMonth();
            renderDatePicker();
        }
        // Time picker OK
        if (t.closest('#timePicker') && t.classList.contains('cp-ok')) {
            var timeVal = String(tpHour).padStart(2, '0') + ':' + String(tpMinute).padStart(2, '0');
            if (state.pickerTarget === 'period-start') {
                document.getElementById('periodStartTime').value = timeVal;
                document.getElementById('periodStartTimeText').textContent = timeVal;
            } else if (state.pickerTarget === 'period-end') {
                document.getElementById('periodEndTime').value = timeVal;
                document.getElementById('periodEndTimeText').textContent = timeVal;
            } else {
                document.getElementById('recTime').value = timeVal;
            }
            updateDatetimeBtns();
            state.pickerTarget = 'record';
            closeTimePicker();
        }
        // Time picker cancel
        if (t.closest('#timePicker') && t.classList.contains('cp-cancel')) closeTimePicker();
    });


        document.addEventListener('click', function(e) {
        var t = e.target || e.srcElement;
        // btn-datetime 内部的 span/icon 也有 id，优先匹配按钮本身
        var dtBtn = t.closest('.btn-datetime');
        var id = dtBtn ? dtBtn.id : ((t.closest('[id]') || t).id || '');
        // Find interactive elements via closest()
        var calCell = t.closest('.cal-cell');
        var moodBtn = t.closest('.mood-btn');
        var tagBtn = t.closest('.tag-btn.multi');
        var ratingBtn = t.closest('.rating-btn');
        var themeBtn = t.closest('.theme-btn');
        var tabBtn = t.closest('.tab-btn');
        var ddView = t.closest('.dd-btn-view');
        var ddEdit = t.closest('.dd-btn-edit');
        var ddDel = t.closest('.dd-btn-del');
        var rcEdit = t.closest('.rc-btn.edit');
        var rcDel = t.closest('.rc-btn.delete');
        var delPeriod = t.closest('.btn-del-period');
        var rcHeader = t.closest('.rc-header');

        // 点击记录头部展开/折叠
        if (rcHeader && !t.closest('.rc-btn')) {
            var card = rcHeader.closest('.record-card');
            if (card) {
                var body = card.querySelector('.rc-body');
                if (body) {
                    body.classList.toggle('collapsed');
                    card.classList.toggle('expanded');
                }
            }
            return;
        }

        if (id === 'btnAddMain' || id === 'btnAdd') {
            openAddRecordModal();
            return;
        }
        if (id === 'modalClose') { hideModal('modalAddRecord'); return; }
        if (id === 'modalPeriodClose') { hideModal('modalAddPeriod'); return; }
        if (id === 'modalViewClose' || id === 'btnViewClose') { hideModal('modalViewRecord'); return; }
        if (id === 'dayDetailClose' || id === 'dayDetailCloseBtn') { hideModal('modalDayDetail'); return; }
        if (id === 'dayDetailAddNew') {
            hideModal('modalDayDetail');
            openAddRecordModal(state.dayDetailDate);
            return;
        }
        // Day detail card buttons
        if (ddView) {
            hideModal('modalDayDetail');
            openViewRecordModal(ddView.dataset.id);
            return;
        }
        if (ddEdit) {
            hideModal('modalDayDetail');
            openEditRecordModal(ddEdit.dataset.id);
            return;
        }
        if (ddDel) {
            hideModal('modalDayDetail');
            doDeleteRecord(ddDel.dataset.id);
            return;
        }
        if (id === 'btnCancel') { hideModal('modalAddRecord'); return; }
        if (id === 'btnPeriodCancel') { hideModal('modalAddPeriod'); return; }
        if (id === 'btnConfirm') { doSaveRecord(); return; }
        if (id === 'btnSaveSettings') { doSaveSettings(); return; }
        if (id === 'btnExportData') {
            var exportData = {
                records: state.records || [],
                periods: state.periods || [],
                settings: state.settings || {},
                exportDate: new Date().toISOString()
            };
            var blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'intimacy_backup_' + fmtDate(new Date()) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }
        if (id === 'btnImportData') {
            document.getElementById('fileImport').click();
            return;
        }
        if (id === 'btnClearAllData') {
            if (!confirm('⚠️ 警告：即将清除所有记录和经期数据！\n\n此操作不可恢复，建议先导出备份。\n\n确定要继续吗？')) return;
            if (!confirm('🔴 最终确认：\n\n删除后所有数据将无法恢复！\n\n请输入确认删除...')) return;
            apiPost('clear_all_data', {confirm: 'YES_DELETE_ALL'}).then(function(r) {
                if (r && r.success) {
                    showError('✅ 所有数据已清除');
                    loadAll();
                    setTimeout(function() { showError(''); }, 3000);
                } else {
                    showError('⚠ 清除失败: ' + (r.error || 'unknown'));
                }
            }).catch(function(err) {
                showError('⚠ 清除失败: ' + err.message);
            });
            return;
        }

        // 主题切换
        if (themeBtn) {
            applyTheme(themeBtn.dataset.theme);
            return;
        }

        // 标签切换
        if (tabBtn) {
            var n = tabBtn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab===n); });
            document.querySelectorAll('.tab-content').forEach(function(t){ t.classList.toggle('active', t.id==='tab-'+n); });
            return;
        }

        // 日历导航
        if (id === 'prevMonth') { state.currentMonth.setMonth(state.currentMonth.getMonth() - 1); renderCalendar(); return; }
        if (id === 'nextMonth') { state.currentMonth.setMonth(state.currentMonth.getMonth() + 1); renderCalendar(); return; }

        // 日历年月快速选择弹窗
        if (id === 'calendarTitle' || t.id === 'calendarTitle') {
            toggleCalendarPicker();
            return;
        }
        if (id === 'pickerPrevYear') {
            state.pickerYear = (state.pickerYear || new Date().getFullYear()) - 1;
            renderPickerMonths();
            return;
        }
        if (id === 'pickerNextYear') {
            state.pickerYear = (state.pickerYear || new Date().getFullYear()) + 1;
            renderPickerMonths();
            return;
        }
        var pickerMonthBtn = t.closest('.picker-month-btn');
        if (pickerMonthBtn && pickerMonthBtn.dataset.month !== undefined) {
            var y = state.pickerYear || new Date().getFullYear();
            var m = parseInt(pickerMonthBtn.dataset.month);
            state.currentMonth = new Date(y, m, 1);
            renderCalendar();
            hideCalendarPicker();
            return;
        }

        // 日历格子点击
        if (calCell && !calCell.classList.contains('empty')) {
            var dateStr = calCell.dataset.date;
            var ids = (calCell.dataset.ids || '').split(',').filter(Boolean);
            if (ids.length > 0) {
                openDayDetailModal(dateStr, ids);
            } else {
                openAddRecordModal(dateStr);
            }
            return;
        }

        // 评分按钮
        if (ratingBtn) {
            setRating(parseInt(ratingBtn.dataset.val));
            return;
        }

        // 心情按钮（单选 mood-grid）
        if (moodBtn) {
            var parent = moodBtn.parentElement;
            var parentId = parent.id;
            if (parentId === 'moodGrid') {
                parent.querySelectorAll('.mood-btn').forEach(function(b){ b.classList.remove('active'); });
                moodBtn.classList.add('active');
                var hi = $('recMood'); if (hi) hi.value = moodBtn.dataset.val;
            } else if (_hiddenMap[parentId]) {
                parent.querySelectorAll('.mood-btn').forEach(function(b){ b.classList.remove('active'); });
                moodBtn.classList.add('active');
                var hiddenId = _hiddenMap[parentId];
                var hel = $(hiddenId);
                if (hel) hel.value = moodBtn.dataset.val;
                // 持续时长选了预设按钮时，隐藏自定义输入框
                if (parentId === 'durationGrid') {
                    var cr = $('durationCustomRow');
                    if (cr) cr.style.display = 'none';
                }
            }
            return;
        }

        // 多选标签（体位/方式/射精/玩具）
        if (tagBtn) {
            tagBtn.classList.toggle('active');
            var p = tagBtn.parentElement;
            var hid = p.nextElementSibling;
            if (hid && hid.type === 'hidden') {
                var vals = [];
                p.querySelectorAll('.tag-btn.multi.active').forEach(function(b){ vals.push(b.dataset.val); });
                hid.value = vals.join('、');
            }
            return;
        }

        // 计时器按钮
        if (id === 'timerStart') { startTimer(); return; }
        if (id === 'timerStop') { stopTimer(); return; }
        if (id === 'timerCancel') { cancelTimer(); return; }

        // Record datetime buttons
        if (id === 'recDateBtn') { state.pickerTarget = 'record'; openDatePicker(); return; }
        if (id === 'recTimeBtn') { state.pickerTarget = 'record'; openTimePicker(); return; }
        // Period datetime buttons
        if (id === 'periodStartDateBtn') { state.pickerTarget = 'period-start'; openDatePicker(); return; }
        if (id === 'periodStartTimeBtn') { state.pickerTarget = 'period-start'; openTimePicker(); return; }
        if (id === 'periodEndDateBtn') { state.pickerTarget = 'period-end'; openDatePicker(); return; }
        if (id === 'periodEndTimeBtn') { state.pickerTarget = 'period-end'; openTimePicker(); return; }

        // 添加经期
                if (id === 'btnAddPeriod') {
            document.getElementById('periodStartDate').value = fmtDate(new Date());
            document.getElementById('periodStartDateText').textContent = fmtDate(new Date());
            document.getElementById('periodEndDate').value = '';
            document.getElementById('periodEndDateText').textContent = '';
            document.getElementById('periodStartTime').value = '00:00';
            document.getElementById('periodStartTimeText').textContent = '00:00';
            document.getElementById('periodEndTime').value = '00:00';
            document.getElementById('periodEndTimeText').textContent = '00:00';
            document.getElementById('periodNotes').value = '';
            showModal('modalAddPeriod');
            return;
        }
                if (id === 'btnPeriodConfirm') {
            var startDate = document.getElementById('periodStartDate').value;
            if (!startDate) { alert('请选择开始日期'); return; }
            var startTime = document.getElementById('periodStartTime').value || '00:00';
            var endTime = document.getElementById('periodEndTime').value || '00:00';
            apiPost('add_period', {
                start_date: startDate + ' ' + startTime,
                end_date: document.getElementById('periodEndDate').value ? document.getElementById('periodEndDate').value + ' ' + endTime : '',
                notes: document.getElementById('periodNotes').value
            }).then(function() {
                hideModal('modalAddPeriod');
                loadAll();
            }).catch(function(e) { alert('添加失败: '+e.message); });
            return;
        }

        // 查看弹窗中的删除按钮（没有 data-id，单独处理）
        if (id === 'btnDeleteRecordInView') {
            doDeleteRecord(state.viewRecordId);
            return;
        }

        // 记录卡片操作
        if (rcEdit) {
            openEditRecordModal(rcEdit.dataset.id);
            return;
        }
        if (rcDel) {
            doDeleteRecord(rcDel.dataset.id);
            return;
        }
        if (delPeriod) {
            if (!confirm('删除这条经期记录？')) return;
            apiPost('delete_period', {period_id: delPeriod.dataset.id}).then(function() { loadAll(); })
                .catch(function(e) { alert('删除失败: '+e.message); });
            return;
        }
        // 点击卡片头部/主体切换展开折叠
        var recordCard = t.closest('.record-card');
        if (recordCard) {
            var body = recordCard.querySelector('.rc-body');
            if (body) body.classList.toggle('collapsed');
            recordCard.classList.toggle('expanded');
            return;
        }

        // 统计时间筛选
        var statsFilterBtn = t.closest('.stats-filter-btn');
        if (statsFilterBtn) {
            var range = statsFilterBtn.dataset.range;
            state.statsRange = range;
            document.querySelectorAll('.stats-filter-btn').forEach(function(b){ b.classList.remove('active'); });
            statsFilterBtn.classList.add('active');
            var ysel = $('statsYearSelect');
            if (range === 'prev') {
                ysel.style.display = '';
                var years = {};
                (state.records||[]).forEach(function(r) {
                    var y = (r.date||'').substring(0,4);
                    if (y && y < String(new Date().getFullYear())) years[y] = true;
                });
                var keys = Object.keys(years).sort().reverse();
                var h = '<option value="">选择年份</option>';
                keys.forEach(function(y) { h += '<option value="'+y+'">'+y+'年</option>'; });
                ysel.innerHTML = h;
                if (state.statsYear) ysel.value = state.statsYear;
            } else {
                ysel.style.display = 'none';
            }
            renderStats();
            return;
        }

        // 筛选下拉框（月份）
        if (id === 'filterMonth') {
            return; // change 事件单独处理
        }
        // 筛选图标按钮
        var filterBtn = t.closest('.filter-icon-btn');
        if (filterBtn && filterBtn.dataset.filter) {
            openFilterPanel(filterBtn);
            e.stopPropagation();
            return;
        }
        // 筛选选项面板内按钮
        var optBtn = t.closest('.filter-opt-btn');
        if (optBtn && optBtn.closest('#filterOptionsPanel')) {
            var field = optBtn.dataset.field;
            var val = optBtn.dataset.val;
            if (state.filter[field] === val) {
                delete state.filter[field];
            } else {
                state.filter[field] = val;
            }
            updateFilterIconState(field);
            renderRecords();
            hideFilterPanel();
            return;
        }
        // 关闭筛选面板
        if (id === 'filterOptionsClose') {
            hideFilterPanel();
            return;
        }
        // 点击面板外部关闭
        if (!t.closest('#filterOptionsPanel') && !t.closest('.filter-icon-btn')) {
            hideFilterPanel();
        }

        // 点击模态框背景关闭
        if (t.classList.contains('modal')) {
            t.classList.add('closing');
            setTimeout(function(){ t.classList.remove('active','closing'); }, 200);
        }

        // 点击日历选择器外部关闭
        if (!t.closest('.calendar-picker') && !t.closest('#calendarTitle')) {
            hideCalendarPicker();
        }
    });

    // 年份下拉变化
    var ysel = $('statsYearSelect');
    if (ysel) {
        ysel.addEventListener('change', function() {
            state.statsYear = ysel.value;
            renderStats();
        });
    }

    // 工具
    function ratingEmoji(v) {
        return '';
    }
    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── 计时器 ──
    function startTimer() {
        if (state.timer.running) return;
        state.timer.running = true;
        state.timer.startTime = Date.now();
        state.timer.elapsed = 0;
        $('timerCard').classList.add('running');
        $('timerLabel').textContent = '计时中...';
        $('timerStart').style.display = 'none';
        $('timerStop').style.display = '';
        $('timerCancel').style.display = '';
        state.timer.intervalId = setInterval(updateTimerDisplay, 200);
        updateTimerDisplay();
    }

    function updateTimerDisplay() {
        var elapsed = Math.floor((Date.now() - state.timer.startTime) / 1000);
        state.timer.elapsed = elapsed;
        var min = Math.floor(elapsed / 60);
        var sec = elapsed % 60;
        $('timerMin').textContent = String(min).padStart(2, '0');
        $('timerSec').textContent = String(sec).padStart(2, '0');
    }

    function stopTimer() {
        if (!state.timer.running) return;
        clearInterval(state.timer.intervalId);
        state.timer.running = false;
        var elapsed = state.timer.elapsed;
        $('timerCard').classList.remove('running');
        $('timerLabel').textContent = '已停止';
        $('timerStart').style.display = '';
        $('timerStop').style.display = 'none';
        $('timerCancel').style.display = 'none';
        // 真实时长，向上取整到分钟
        var realMin = Math.max(1, Math.ceil(elapsed / 60));
        // 获取当前时间
        var now = new Date();
        var dateStr = fmtDate(now);
        var timeStr = fmtTime(now);
        // 打开添加记录弹窗并预填
        openAddRecordModal(dateStr);
        $('recTime').value = timeStr;
        updateDatetimeBtns();
        setDurationValue(realMin);
        $('timerMin').textContent = '00';
        $('timerSec').textContent = '00';
        $('timerLabel').textContent = '准备就绪';
    }

    function cancelTimer() {
        if (!state.timer.running) return;
        clearInterval(state.timer.intervalId);
        state.timer.running = false;
        state.timer.elapsed = 0;
        $('timerCard').classList.remove('running');
        $('timerLabel').textContent = '已取消';
        $('timerStart').style.display = '';
        $('timerStop').style.display = 'none';
        $('timerCancel').style.display = 'none';
        $('timerMin').textContent = '00';
        $('timerSec').textContent = '00';
        setTimeout(function() { $('timerLabel').textContent = '准备就绪'; }, 1500);
    }

    function setDurationValue(minutes) {
        // 取消所有预设按钮选中
        var grid = $('durationGrid');
        if (grid) grid.querySelectorAll('.mood-btn').forEach(function(b){ b.classList.remove('active'); });
        // 尝试匹配预设按钮
        var matched = false;
        if (grid) {
            var btn = grid.querySelector('.mood-btn[data-val="'+minutes+'"]');
            if (btn) { btn.classList.add('active'); matched = true; }
        }
        // 如果不在预设中，显示手动输入框
        if (!matched) {
            var customRow = $('durationCustomRow');
            if (!customRow) {
                customRow = document.createElement('div');
                customRow.id = 'durationCustomRow';
                customRow.className = 'form-group';
                customRow.style.marginTop = '8px';
                customRow.innerHTML = '<label><svg class="icon"><use href="#icon-timer"/></svg> 实际时长（分钟）</label><input type="number" id="recDurationCustom" min="1" max="600" style="width:100%;background:var(--bg-input);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font-size:14px">';
                grid.parentElement.insertAdjacentElement('afterend', customRow);
                $('recDurationCustom').addEventListener('input', function(){
                    $('recDuration').value = this.value || 1;
                });
            }
            customRow.style.display = '';
            $('recDurationCustom').value = minutes;
        } else {
            var cr = $('durationCustomRow');
            if (cr) cr.style.display = 'none';
        }
        $('recDuration').value = minutes;
    }

    // 初始化
    (function initTheme() {
        var t = 'dark';
        try { t = localStorage.getItem('intimacy_theme') || 'dark'; } catch(e){}
        // 暧昧主题已移除，回退到暗黑
        if (t === 'ambiguous') t = 'dark';
        applyTheme(t);
    })();
    initDatetimeBtns();
    // ── 导入文件处理 ──
    document.getElementById('fileImport').addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            try {
                var data = JSON.parse(ev.target.result);
                var tasks = [];
                if (data.records && data.records.length) {
                    tasks.push(apiPost('import_records', {records: data.records}));
                }
                if (data.periods && data.periods.length) {
                    tasks.push(apiPost('import_periods', {periods: data.periods}));
                }
                if (!tasks.length) { showError('⚠ 文件中无有效数据'); return; }
                Promise.all(tasks).then(function(results) {
                    var msg = '✅ 导入完成';
                    var parts = [];
                    results.forEach(function(r) {
                        if (r && r.added !== undefined) {
                            parts.push('新增 ' + r.added + ' 条' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 条' : ''));
                        }
                    });
                    if (parts.length) msg += '：' + parts.join('；');
                    showError(msg);
                    loadAll();
                    setTimeout(function() { showError(''); }, 4000);
                }).catch(function(err) {
                    showError('⚠ 导入失败: ' + err.message);
                });
            } catch(ex) {
                showError('⚠ 文件格式错误');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });
    // ── 一键展开/折叠年月分组 ──
    document.getElementById('btnToggleAllRecords').addEventListener('click', function() {
        var headers = document.querySelectorAll('#recordList .year-header, #recordList .month-header');
        var anyClosed = Array.from(headers).some(function(h) { return !h.classList.contains('open'); });
        headers.forEach(function(h) {
            var body = h.nextElementSibling;
            if (!body) return;
            if (anyClosed) {
                h.classList.add('open');
                body.classList.add('open');
            } else {
                h.classList.remove('open');
                body.classList.remove('open');
            }
        });
        this.textContent = anyClosed ? '全部折叠 ▴' : '全部展开 ▾';
    });

    // ── 筛选面板 ──
    function openFilterPanel(btn) {
        var field = btn.dataset.filter;
        var cfg = FILTER_CONFIG[field];
        if (!cfg) return;
        var panel = $('filterOptionsPanel');
        var title = $('filterOptionsTitle');
        var body = $('filterOptionsBody');
        title.textContent = cfg.title;
        var currentVal = state.filter[field] || '';
        var html = '';
        cfg.options.forEach(function(opt) {
            var active = opt.val === currentVal ? 'active' : '';
            html += '<button class="filter-opt-btn ' + active + '" data-field="' + field + '" data-val="' + opt.val + '">' + opt.label + '</button>';
        });
        body.innerHTML = html;
        // 定位面板（position: absolute 相对于 filterBarGrid）
        var bar = $('filterBarGrid');
        if (!bar) return;
        var rect = btn.getBoundingClientRect();
        var barRect = bar.getBoundingClientRect();
        // 水平：按钮左边界减去容器左边界的偏移
        var left = rect.left - barRect.left + bar.scrollLeft;
        panel.style.left = left + 'px';
        // 垂直：按钮底部相对容器顶部偏移
        var top = rect.bottom - barRect.top + bar.scrollTop + 4;
        panel.style.top = top + 'px';
        panel.style.display = 'block';
        panel.classList.add('active');
    }
    function hideFilterPanel() {
        var panel = $('filterOptionsPanel');
        if (panel) { panel.classList.remove('active'); panel.style.display = 'none'; }
    }
    function updateFilterIconState(field) {
        var btn = document.querySelector('.filter-icon-btn[data-filter="' + field + '"]');
        if (!btn) return;
        if (state.filter[field]) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    // 月份下拉框 change 事件
    var monthSelect = $('filterMonth');
    if (monthSelect) {
        monthSelect.addEventListener('change', function() {
            renderRecords();
        });
    }

    // 一键清除筛选
    document.addEventListener('click', function(e) {
        var t = e.target;
        if (t.closest && t.closest('#btnClearFilters')) {
            state.filter = {};
            if (monthSelect) monthSelect.value = '';
            document.querySelectorAll('.filter-icon-btn').forEach(function(b) { b.classList.remove('active'); });
            hideFilterPanel();
            renderRecords();
        }
    });

    console.log('[私密记录 v'+VERSION+'] 启动');
    // 显示错误横幅
    function showError(msg) {
        var bar = $('errorBanner');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'errorBanner';
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#e53e3e;color:#fff;padding:12px 16px;font-size:14px;text-align:center;cursor:pointer;';
            document.body.prepend(bar);
        }
        bar.textContent = msg;
        bar.style.display = msg ? '' : 'none';
    }
    loadAll().then(function() {
        var errs = [];
        if (!state.stats || state.stats.error) errs.push('stats: ' + (state.stats.error || 'empty'));
        if (!state.records.length) errs.push('records: 0');
        if (!state.periods.length) errs.push('periods: 0');
        if (errs.length) showError('⚠ 数据加载异常: ' + errs.join(', ') + ' — 请打开浏览器控制台(F12)查看详细日志');
        else showError('');
    });


})();
