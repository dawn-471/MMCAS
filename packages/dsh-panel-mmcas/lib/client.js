window.__ModuleLoader__.load({
  id: "@mmcas/dsh-panel",
  factory: (require) => {
    var React = require("react");
    var useState = React.useState;
    var useEffect = React.useEffect;
    var Fragment = React.Fragment;

    // ---------- CSS（--dsw 语义变量，跟随 dsh 明暗主题） ----------
    var css = [
      ".mmcas-btn{display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;height:32px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary,#8a94a6);cursor:pointer;transition:background .15s,color .15s;padding:0 10px;font-size:13px}",
      ".mmcas-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#2a2f3c);color:var(--dsw-alias-label-primary,#e8eaf0)}",
      ".mmcas-btn svg{width:16px;height:16px;flex:none}",
      ".mmcas-wrap{margin-top:6px}",
      ".mmcas-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9998}",
      ".mmcas-drawer{position:fixed;top:0;right:0;bottom:0;width:720px;max-width:92vw;z-index:9999;display:flex;flex-direction:column;background:var(--dsw-specific-sidebar-fill,#151821);border-left:1px solid var(--dsw-alias-border-l3,#2a2f3c);box-shadow:-12px 0 40px rgba(0,0,0,.35)}",
      ".mmcas-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,#2a2f3c)}",
      ".mmcas-head h3{flex:1;margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaf0)}",
      ".mmcas-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#8a94a6);cursor:pointer;font-size:18px;line-height:1;padding:4px 8px;border-radius:8px}",
      ".mmcas-close:hover{background:var(--dsw-alias-interactive-bg-hover,#2a2f3c)}",
      ".mmcas-body{flex:1;overflow-y:auto;padding:12px 16px}",
      ".mmcas-sec{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--dsw-alias-label-tertiary,#6a7282);margin:14px 0 8px}",
      ".mmcas-chips{display:flex;gap:8px;flex-wrap:wrap}",
      ".mmcas-chip{font-size:11.5px;padding:4px 10px;border-radius:20px;border:1px solid var(--dsw-alias-border-l3,#2a2f3c);color:var(--dsw-alias-label-secondary,#8a94a6);display:inline-flex;align-items:center;gap:6px}",
      ".mmcas-dot{width:8px;height:8px;border-radius:50%;display:inline-block}",
      ".mmcas-dot.on{background:#5fd38a}.mmcas-dot.off{background:#ff7d6b}",
      ".mmcas-empty{color:var(--dsw-alias-label-tertiary,#6a7282);font-size:12px;padding:6px 0}",
      ".mmcas-mem{border-bottom:1px dashed var(--dsw-alias-border-l3,#2a2f3c);padding:7px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#8a94a6);line-height:1.5}",
      ".mmcas-mem .r{color:var(--dsw-alias-label-tertiary,#6a7282);font-size:10.5px}",
      ".mmcas-git{display:flex;gap:10px;font-family:Consolas,monospace;font-size:11px;padding:3px 0;border-bottom:1px dashed var(--dsw-alias-border-l3,#2a2f3c);color:var(--dsw-alias-label-secondary,#8a94a6)}",
      ".mmcas-git .h{color:var(--dsw-alias-state-business-primary,#4da3ff);width:62px;flex:none}",
      ".mmcas-sync{font-size:11px;color:var(--dsw-alias-label-tertiary,#6a7282)}",
      ".mmcas-sync.warn{color:#ffb84d}",
      ".mmcas-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#6a7282);min-width:62px;flex:none}",
      ".mmcas-btn-mini{background:transparent;border:1px solid var(--dsw-alias-border,#3a3f4a);border-radius:6px;color:inherit;padding:3px 10px;font-size:12px;cursor:pointer}",
      ".mmcas-input,.mmcas-select,.mmcas-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l3,#2a2f3c);background:var(--dsw-alias-button-elevated-fill,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e8eaf0);border-radius:8px;padding:7px 10px;font-size:13px;outline:none;font-family:inherit}",
      ".mmcas-input:focus,.mmcas-textarea:focus{border-color:var(--dsw-alias-state-business-primary,#4da3ff)}",
      ".mmcas-textarea{min-height:64px;resize:vertical}",
      ".mmcas-row{display:flex;gap:8px;margin-bottom:8px;align-items:center}",
      ".mmcas-btn-primary{border:none;border-radius:8px;background:var(--dsw-alias-state-business-primary,#4da3ff);color:#fff;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer}",
      ".mmcas-btn-primary:hover{filter:brightness(1.1)}",
      ".mmcas-btn-ghost{border:1px solid var(--dsw-alias-border-l3,#2a2f3c);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#8a94a6);padding:6px 12px;font-size:12px;cursor:pointer}",
      ".mmcas-btn-ghost:hover{color:var(--dsw-alias-label-primary,#e8eaf0)}",
      ".mmcas-btn-danger{border:1px solid #7a3d33;border-radius:8px;background:transparent;color:#ff7d6b;padding:6px 12px;font-size:12px;cursor:pointer}",
      ".mmcas-board{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:10px}",
      ".mmcas-col{background:var(--dsw-alias-button-elevated-fill,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l3,#2a2f3c);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;max-height:52vh}",
      ".mmcas-col-head{display:flex;align-items:center;gap:6px;padding:9px 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaf0);border-bottom:1px solid var(--dsw-alias-border-l3,#2a2f3c)}",
      ".mmcas-col-head .n{margin-left:auto;color:var(--dsw-alias-label-tertiary,#6a7282);font-weight:400}",
      ".mmcas-col-body{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px}",
      ".mmcas-card{background:var(--dsw-alias-button-elevated-fill,rgba(255,255,255,.02));border:1px solid var(--dsw-alias-border-l3,#2a2f3c);border-radius:10px;padding:9px 10px;cursor:pointer;transition:border-color .15s}",
      ".mmcas-card:hover{border-color:var(--dsw-alias-state-business-primary,#4da3ff)}",
      ".mmcas-card .t{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary,#e8eaf0);line-height:1.4}",
      ".mmcas-card .m{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6a7282);margin-top:5px;display:flex;gap:6px;align-items:center}",
      ".mmcas-avatar{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none}",
      ".mmcas-detail{background:var(--dsw-alias-button-elevated-fill,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l3,#2a2f3c);border-radius:12px;padding:12px;margin-top:10px}",
      ".mmcas-detail h4{margin:0 0 6px;font-size:14px;color:var(--dsw-alias-label-primary,#e8eaf0)}",
      ".mmcas-detail .bd{font-size:12.5px;color:var(--dsw-alias-label-secondary,#8a94a6);white-space:pre-wrap;line-height:1.6;margin-bottom:10px}",
      ".mmcas-actions{display:flex;gap:8px;flex-wrap:wrap}",
      ".mmcas-console{background:#0c0e14;border:1px solid var(--dsw-alias-border-l3,#2a2f3c);border-radius:10px;padding:10px;font-family:Consolas,monospace;font-size:11.5px;color:#c8d3e8;white-space:pre-wrap;max-height:260px;overflow-y:auto;min-height:60px}",
      ".mmcas-console .err{color:#ff7d6b}"
    ].join("\n");
    if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css='mmcas-panel']")) {
      var tag = document.createElement("style");
      tag.dataset.pluginCss = "mmcas-panel";
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    var COLS = [["todo", "待办", "#8a94a6"], ["doing", "进行中", "#4da3ff"], ["done", "完成", "#5fd38a"]];
    var ROLE_C = { modeler: "#4da3ff", coder: "#9c6bff", writer: "#5fd38a" };
    var ROLE_I = { modeler: "M", coder: "C", writer: "W" };
    // 看板/总控/记忆统一 30 秒一刷；刷新的数据源是宿主 /api/refresh —— 它先与 git 远端对齐
    // （coder、writer 端 push 的卡变更由此进来），再回最新的卡与同步水位
    var REFRESH_MS = 30000;
    // 数据端点：默认 127.0.0.1:3210；多实例并存时 = web 端口 + 11（3199→3210, 3200→3211）
    var API = "http://127.0.0.1:3210";
    if (typeof window !== "undefined" && window.__MMCAS_API__) {
      API = window.__MMCAS_API__;
    } else if (typeof location !== "undefined" && location.port && (location.port === "3199" || location.port === "3200")) {
      // 仅已知多实例端口重算：3199(Master)→3210, 3200(Slave demo)→3211；其余（队友端默认 3080）一律 3210
      API = "http://127.0.0.1:" + (parseInt(location.port, 10) + 11);
    }

    function el(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(null, [type, props].concat(children));
    }
    function avatar(role) {
      var c = ROLE_C[role] || "#8a94a6";
      return el("span", { className: "mmcas-avatar", style: { background: c + "22", color: c } }, ROLE_I[role] || "?");
    }
    function apiCall(method, path, body) {
      return fetch(API + path, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) { return r.json(); });
    }
    function fmtTime(iso) {
      if (!iso) return "—";
      try { return new Date(iso).toLocaleTimeString(); } catch (e) { return "—"; }
    }
    function syncText(sync) {
      if (!sync) return "同步状态读取中…";
      var t = "上次同步 " + fmtTime(sync.lastRunAt) + " · " + (sync.note || "");
      if (sync.running) t += "（正在与远端对齐）";
      if (sync.behind) t += "（落后 " + sync.behind + "）";
      else if (sync.ahead) t += "（领先 " + sync.ahead + "）";
      if (sync.heartbeat) {   // v1.2 T5.3：守护心跳
        if (sync.heartbeat.alive) t += " · 守护心跳 " + sync.heartbeat.ageSec + "s 前";
        else t += " · ⚠ 守护心跳停滞" + (sync.heartbeat.ageSec === null || sync.heartbeat.ageSec === undefined ? "（未运行）" : "（" + sync.heartbeat.ageSec + "s）");
        var hm = sync.heartbeat.mode;
        if (hm === "conflict") t += " · ⚠ 同步冲突暂停（待人工解决）";
        else if (hm === "blocked") t += " · ⚠ 入库体检拦截（见 sync 日志）";
        else if (hm && hm !== "normal") t += " · ⚠ 同步状态: " + hm;
      }
      return t;
    }

    // ---------- 视图: 总控 ----------
    function Overview() {
      var _s = useState(null), state = _s[0], setState = _s[1];
      var _c = useState(""), cmd = _c[0], setCmd = _c[1];
      var _r = useState(null), roleSel = _r[0], setRoleSel = _r[1];
      var _o = useState(null), out = _o[0], setOut = _o[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _sn = useState(false), syncing = _sn[0], setSyncing = _sn[1];

      function load() {
        fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) { setState(s); }).catch(function () {});
      }
      useEffect(function () {
        load();
        var t = setInterval(load, REFRESH_MS); // 总控同样 30 秒一刷（宿主每 30 秒做一次 git 同步）
        return function () { clearInterval(t); };
      }, []);
      function syncNow() {
        setSyncing(true);
        apiCall("POST", "/api/sync", {}).then(function () { setSyncing(false); load(); }).catch(function () { setSyncing(false); });
      }

      var devs = (state && state.devices) || {};
      var git = (state && state.git) || { log: [], branch: "", ahead: 0, behind: 0 };
      var role = roleSel || "coder";

      function runCmd(preset) {
        var c = preset || cmd;
        if (!c.trim()) return;
        setBusy(true);
        setOut("执行中: " + c);
        apiCall("POST", "/api/exec", { role: role, cmd: c, timeoutSec: 30 }).then(function (r) {
          setBusy(false);
          setOut(r.stdout || r.stderr || r.error || "(无输出)");
        }).catch(function (e) { setBusy(false); setOut("请求失败: " + e); });
      }

      var devChips = Object.keys(devs).map(function (k) {
        var d = devs[k];
        return el("span", { className: "mmcas-chip", key: k },
          el("span", { className: "mmcas-dot " + (d.online ? "on" : "off") }),
          (d.name || k) + (d.ip ? " · " + d.ip : ""),
          d.online ? "在线" : "离线"
        );
      });

      var syncTxt = git.ahead > 0 || git.behind > 0
        ? "本地领先 " + git.ahead + " / 落后 " + git.behind + " 个提交（需同步）"
        : "与远端同步";

      // ---- 任务轮询器开关 ----
      var _pl = useState(null), pollerState = _pl[0], setPollerState = _pl[1];
      function loadPoller() {
        fetch(API + "/api/poller").then(function (r) { return r.json(); }).then(setPollerState).catch(function () {});
      }
      useEffect(function () { loadPoller(); var t = setInterval(loadPoller, 15000); return function () { clearInterval(t); }; }, []);
      function setPoller(enabled) {
        apiCall("POST", "/api/poller", { enabled: enabled }).then(function (r) { if (r.ok) setPollerState(r); });
      }
      function setPollerOpt(opt) {
        apiCall("POST", "/api/poller", opt).then(function (r) { if (r.ok) loadPoller(); });
      }
      var _lt = useState(null), lastTick = _lt[0], setLastTick = _lt[1];
      useEffect(function () {
        fetch(API + "/api/poller").then(function (r) { return r.json(); })
          .then(function (s) { if (s && s.history && s.history.length) setLastTick(s.history[s.history.length - 1]); })
          .catch(function () {});
      }, []);

      var pollerUi = el(Fragment, null,
        el("div", { className: "mmcas-sec" }, "任务轮询器（自动接取派发）"),
        el("div", { className: "mmcas-row" },
          el("button", {
            className: pollerState && pollerState.enabled ? "mmcas-btn-primary" : "mmcas-btn-ghost",
            onClick: function () { setPoller(true); }
          }, "开启：自动轮询接取"),
          el("button", {
            className: pollerState && !pollerState.enabled ? "mmcas-btn-primary" : "mmcas-btn-ghost",
            onClick: function () { setPoller(false); }
          }, "关闭：能工智人接取")
        ),
        el("div", { className: "mmcas-row" },
          el("button", {
            className: pollerState && pollerState.autoClaim ? "mmcas-btn-primary" : "mmcas-btn-ghost",
            onClick: function () { setPollerOpt({ autoClaim: true }); }
          }, "自动接取：开（todo→doing 由轮询器翻牌）"),
          el("button", {
            className: pollerState && pollerState.autoClaim === false ? "mmcas-btn-primary" : "mmcas-btn-ghost",
            onClick: function () { setPollerOpt({ autoClaim: false }); }
          }, "自动接取：关（只提醒、不翻牌）"),
          el("button", {
            className: "mmcas-btn-ghost",
            onClick: function () { apiCall("POST", "/api/poller/now", {}).then(function (r) { if (r && r.tick) setLastTick(r.tick); loadPoller(); }); }
          }, "立即轮询一次")
        ),
        el("div", { className: "mmcas-empty" },
          pollerState && pollerState.enabled
            ? "轮询中（每 " + (pollerState.intervalSec || 120) + " 秒）· 上次检测 " + (pollerState.lastRun ? new Date(pollerState.lastRun).toLocaleTimeString() : "—")
              + " · 自动接取 " + (pollerState.autoClaim === false ? "关" : "开")
              + (pollerState.lastFound && pollerState.lastFound.length ? " · 本轮就绪: " + pollerState.lastFound.join(",") : "")
              + (pollerState.lastBlocked && pollerState.lastBlocked.length ? " · 被 WIP 挡住: " + pollerState.lastBlocked.join(",") : "")
              + (pollerState.lastTargetSessionId ? " · 派发到会话 " + String(pollerState.lastTargetSessionId).slice(0, 12) : "")
              + (pollerState.claims && pollerState.claims.length
                  ? " · 最近自动接取: " + pollerState.claims.map(function (c) { return c.id; }).join(",") : "")
            : "已关闭——agent 仅在能工智人发话时接取任务"
        ),
        lastTick ? el("div", { className: "mmcas-empty" },
          "本次 tick：" + (lastTick.claimed && lastTick.claimed.length ? "自动接取 " + lastTick.claimed.join(",") + "；" : "")
            + (lastTick.dispatched && lastTick.dispatched.length ? "已派发 " + lastTick.dispatched.join(",") : "无派发")
            + (lastTick.note ? "；" + lastTick.note : "")) : null
      );

      // ---- v1.2：消息区（notices：收发件箱 + ack） ----
      var _nt = useState(null), notices = _nt[0], setNotices = _nt[1];
      var _ntf = useState({ to: "coder", kind: "info", urgency: "normal", scope: "", body: "" }), nForm = _ntf[0], setNForm = _ntf[1];
      var _ntb = useState(false), ntBusy = _ntb[0], setNtBusy = _ntb[1];
      function loadNotices() {
        fetch(API + "/api/notices").then(function (r) { return r.json(); }).then(function (s) { setNotices((s && s.items) || []); }).catch(function () {});
      }
      useEffect(function () { loadNotices(); var t = setInterval(loadNotices, 10000); return function () { clearInterval(t); }; }, []);
      function sendNotice() {
        if (!nForm.body.trim()) return;
        setNtBusy(true);
        apiCall("POST", "/api/notices", nForm).then(function (r) { setNtBusy(false); if (r && r.ok) { setNForm({ ...nForm, body: "", scope: "" }); loadNotices(); } }).catch(function () { setNtBusy(false); });
      }
      function ackNotice(id) { apiCall("POST", "/api/notices/ack", { id: id }).then(function () { loadNotices(); }); }
      var KIND_LABEL = { ruling: "裁决请求", error: "错误上报", stop: "停止指令", info: "一般" };
      var myRoleN = (state && state.role) || "coder";
      var noticeTargets = myRoleN === "modeler" ? ["coder", "writer", "modeler", "all"] : ["modeler"];
      var inboxList = (notices || []).filter(function (n) { return n.to === myRoleN || n.to === "all" || n.from === myRoleN; }).slice(0, 12);
      var noticesUi = el(Fragment, null,
        el("div", { className: "mmcas-sec" }, "消息（跨端通知 / 停止指令 / 回执）"),
        el("div", { className: "mmcas-row" },
          el("select", { className: "mmcas-select", style: { width: "96px", flex: "none" }, value: nForm.to, onChange: function (e) { setNForm({ ...nForm, to: e.target.value }); } },
            noticeTargets.map(function (x) { return el("option", { value: x, key: x }, x); })),
          el("select", { className: "mmcas-select", style: { width: "104px", flex: "none" }, value: nForm.kind, onChange: function (e) { setNForm({ ...nForm, kind: e.target.value }); } },
            Object.keys(KIND_LABEL).map(function (x) { return el("option", { value: x, key: x }, KIND_LABEL[x]); })),
          el("select", { className: "mmcas-select", style: { width: "110px", flex: "none" }, value: nForm.urgency, onChange: function (e) { setNForm({ ...nForm, urgency: e.target.value }); } },
            el("option", { value: "normal" }, "普通"),
            el("option", { value: "urgent" }, "紧急（打断）"))
        ),
        el("div", { className: "mmcas-row" },
          el("input", { className: "mmcas-input", placeholder: "范围（可选：T-115 或 T-115,T-116——停止某方向时用）", value: nForm.scope, onChange: function (e) { setNForm({ ...nForm, scope: e.target.value }); } })
        ),
        el("textarea", { className: "mmcas-textarea", placeholder: "正文", value: nForm.body, onChange: function (e) { setNForm({ ...nForm, body: e.target.value }); } }),
        el("div", { className: "mmcas-row", style: { marginTop: "8px" } },
          el("button", { className: "mmcas-btn-primary", disabled: ntBusy, onClick: sendNotice }, ntBusy ? "发送中…" : "发送")),
        inboxList.length ? inboxList.map(function (n) {
          var mine = n.to === myRoleN || n.to === "all";
          return el("div", { className: "mmcas-mem", key: n.id },
            el("span", { style: { fontWeight: 600, color: n.urgency === "urgent" ? "#ff7d6b" : "inherit" } }, "[" + (KIND_LABEL[n.kind] || n.kind) + (n.urgency === "urgent" ? "·紧急" : "") + "] "),
            n.from + " → " + n.to + " · " + n.status + " · " + (n.body || "").slice(0, 110),
            mine && n.status !== "acked" ? el("button", { className: "mmcas-btn-ghost", style: { marginLeft: "8px", padding: "2px 8px" }, onClick: function () { ackNotice(n.id); } }, "回执") : null
          );
        }) : el("div", { className: "mmcas-empty" }, "（暂无消息）")
      );

      // ---- 环境同步（方案 B）----
      var _es = useState(null), envSync = _es[0], setEnvSync = _es[1];
      var _esb = useState(false), esBusy = _esb[0], setEsBusy = _esb[1];
      var _esm = useState(""), esMsg = _esm[0], setEsMsg = _esm[1];

      function loadEnvSync() {
        fetch(API + "/api/env-sync").then(function (r) { return r.json(); }).then(setEnvSync).catch(function () {});
      }
      useEffect(function () { loadEnvSync(); var t = setInterval(loadEnvSync, 8000); return function () { clearInterval(t); }; }, []);

      function esCall(path, body) {
        setEsBusy(true);
        return apiCall("POST", path, body).then(function (r) { setEsBusy(false); if (!r.ok) setEsMsg(r.error || "失败"); return r; }).catch(function (e) { setEsBusy(false); setEsMsg(String(e)); });
      }

      var syncUi = null;
      if (envSync) {
        var myRole = (state && state.role) || role;
        var pending = (envSync.requests || []).filter(function (q) {
          return !(envSync.responses || []).some(function (r) { return r.id === q.id && r.from === myRole; });
        });
        var myRequests = (envSync.requests || []).filter(function (q) { return q.from === myRole; });
        var openTransfer = envSync.transfer && !(envSync.done || []).some(function (d) { return d.endsWith("-" + myRole); });
        var transferDone = envSync.transfer && (envSync.done || []).length >= 2;

        syncUi = el(Fragment, null,
          el("div", { className: "mmcas-sec" }, "环境同步（方案 B：三方同意 + P2P 对齐）"),
          esMsg ? el("div", { className: "mmcas-empty" }, esMsg) : null,
          pending.length ? pending.map(function (q) {
            return el("div", { className: "mmcas-detail", key: q.id },
              el("h4", null, "环境同步请求 " + q.id),
              el("div", { className: "bd" }, q.note),
              el("div", { className: "mmcas-actions" },
                el("button", { className: "mmcas-btn-primary", disabled: esBusy, onClick: function () { esCall("/api/env-sync/respond", { id: q.id, agree: true }); } }, "同意"),
                el("button", { className: "mmcas-btn-danger", disabled: esBusy, onClick: function () { esCall("/api/env-sync/respond", { id: q.id, agree: false }); } }, "拒绝")
              )
            );
          }) : el("div", { className: "mmcas-row" },
            el("button", { className: "mmcas-btn-primary", disabled: esBusy, onClick: function () { esCall("/api/env-sync/request", {}); } }, "一键同步（发起环境对齐）")
          ),
          myRequests.length ? el("div", { className: "mmcas-empty" }, "我的请求 " + myRequests.map(function (q) {
            var ag = (envSync.responses || []).filter(function (r) { return r.id === q.id && r.agree; }).map(function (r) { return r.from; });
            return q.id + "：已同意 " + ag.join("/") + " / 待 " + (3 - 1 - ag.length) + " 端";
          }).join("；")) : null,
          myRequests.length && myRequests.some(function (q) {
            return (envSync.responses || []).filter(function (r) { return r.id === q.id && r.agree; }).length >= 2 && !(envSync.transfer && envSync.transfer.id === q.id);
          }) ? el("div", { className: "mmcas-row" },
            el("button", { className: "mmcas-btn-primary", disabled: esBusy, onClick: function () { var q = myRequests[0]; esCall("/api/env-sync/prepare", { id: q.id }); } }, "准备环境包（打包 + 开放 P2P 下载）")
          ) : null,
          openTransfer && envSync.transfer.from !== myRole ? el("div", { className: "mmcas-detail" },
            el("h4", null, "环境包已就绪（来自 " + envSync.transfer.from + "）"),
            el("div", { className: "mmcas-actions" },
              el("button", { className: "mmcas-btn-primary", disabled: esBusy, onClick: function () { esCall("/api/env-sync/pull", { transfer: envSync.transfer }).then(function (r) { setEsMsg(r.out || r.err || "完成"); }); } }, "开始对齐（P2P 下载并安装差异）")
            )
          ) : null,
          transferDone ? el("div", { className: "mmcas-empty" }, "环境已对齐 ✓") : null
        );
      }

      // 操控门户仅 Master（role 来自 /api/state）
      var isMaster = (state && state.role) === "modeler";
      var controlPortal = isMaster ? el(Fragment, null,
        el("div", { className: "mmcas-sec" }, "Slave 操控门户"),
        el("div", { className: "mmcas-row" },
          el("select", { className: "mmcas-select", style: { width: "110px", flex: "none" }, value: roleSel || "coder", onChange: function (e) { setRoleSel(e.target.value); } },
            el("option", { value: "coder" }, "编程手 C"),
            el("option", { value: "writer" }, "论文手 W")
          ),
          el("input", {
            className: "mmcas-input", placeholder: "输入远程命令，如 python --version",
            value: cmd, onChange: function (e) { setCmd(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter") runCmd(); }
          }),
          el("button", { className: "mmcas-btn-primary", disabled: busy, onClick: function () { runCmd(); } }, busy ? "执行中" : "执行")
        ),
        el("div", { className: "mmcas-row" },
          el("button", { className: "mmcas-btn-ghost", onClick: function () { runCmd("tailscale status"); } }, "设备状态"),
          el("button", { className: "mmcas-btn-ghost", onClick: function () { runCmd("tasklist | findstr /i node"); } }, "进程检查"),
          el("button", { className: "mmcas-btn-ghost", onClick: function () { runCmd("python --version"); } }, "Python 版本"),
          el("button", { className: "mmcas-btn-ghost", onClick: function () { runCmd("cd workspace && git status -sb"); } }, "工作区状态")
        ),
        el("div", { className: "mmcas-console" }, out || "（执行结果将显示在此）")
      ) : null;

      return el(Fragment, null,
        el("div", { className: "mmcas-sec" }, "成员设备"),
        el("div", { className: "mmcas-chips" }, devChips),
        pollerUi,
        noticesUi,
        syncUi,
        controlPortal,
        el("div", { className: "mmcas-sec" }, "上下文水位"),
        ((state && state.tokens) || []).length
          ? ((state && state.tokens) || []).map(function (t) {
              var warn = t.total > 700000;
              return el("div", { className: "mmcas-sync " + (warn ? "warn" : ""), key: t.id }, (t.title || String(t.id).slice(0, 12)) + " · ~" + Math.round((t.total || 0) / 1000) + "K token" + (warn ? " ← 接近上限，先落盘交接（卡批注 + memory）再继续或换会话" : ""));
            })
          : el("div", { className: "mmcas-empty" }, "（暂无水位数据）"),
        el("div", { className: "mmcas-sec" }, "同步水位"),
        el("div", { className: "mmcas-row" },
          el("button", { className: "mmcas-btn-ghost", onClick: syncNow, disabled: syncing }, syncing ? "同步中…" : "立即同步"),
          el("span", { className: "mmcas-sync " + (state && state.sync && state.sync.ok === false ? "warn" : "") }, syncText(state && state.sync))
        ),
        el("div", { className: "mmcas-sync " + (git.ahead || git.behind ? "warn" : "") }, git.branch + " · " + syncTxt),
        (git.log || []).map(function (l, i) {
          var p = l.split("|");
          return el("div", { className: "mmcas-git", key: i },
            el("span", { className: "h" }, p[0]),
            el("span", { style: { width: "96px", flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p[1]),
            el("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.slice(2).join("|"))
          );
        })
      );
    }

    // ---------- 视图: 真看板（三状态 + CRUD） ----------
    function Board() {
      var _s = useState({ cards: [] }), st = _s[0], setSt = _s[1];
      var _d = useState(null), detail = _d[0], setDetail = _d[1];
      var _n = useState(false), creating = _n[0], setCreating = _n[1];
      var _t = useState(""), title = _t[0], setTitle = _t[1];
      var _o = useState("coder"), owner = _o[0], setOwner = _o[1];
      var _p = useState("P1"), priority = _p[0], setPriority = _p[1];
      var _dp = useState(""), depsIn = _dp[0], setDepsIn = _dp[1];
      var _b = useState(""), desc = _b[0], setDesc = _b[1];
      var _e = useState(""), err = _e[0], setErr = _e[1];
      var _f = useState("all"), filter = _f[0], setFilter = _f[1];
      var _r = useState("modeler"), myRole = _r[0], setMyRole = _r[1];
      var _wl = useState(0), wipLimit = _wl[0], setWipLimit = _wl[1];
      var _ed = useState(false), editing = _ed[0], setEditing = _ed[1];
      var _ef = useState({ title: "", owner: "coder", priority: "P1", deps: "", desc: "" }), form = _ef[0], setForm = _ef[1];
      var _sy = useState(null), sync = _sy[0], setSync = _sy[1];
      var _syb = useState(false), syncing = _syb[0], setSyncing = _syb[1];

      // 刷新 = 宿主先与 git 远端对齐（coder/writer 端的卡变更由此进入本端），再回最新卡
      function load(force, isRetry) {
        if (force) setSyncing(true);
        return apiCall("GET", "/api/refresh" + (force ? "?force=1" : "")).then(function (r) {
          if (!r || !r.cards) throw new Error((r && r.error) || "空响应");
          setSt({ cards: r.cards });
          if (r.sync) setSync(r.sync);
          setErr("");
          // 宿主正在后台与 git 对齐：2 秒后补取一次，让卡面尽快跟上（只补一次，不成环）
          if (r.sync && r.sync.running && !isRetry) setTimeout(function () { load(false, true); }, 2000);
        }).catch(function () {
          // 宿主尚未更新时退回只读端点：至少卡片仍能刷新，只是不带 git 同步
          return apiCall("GET", "/api/tasks").then(function (r2) {
            if (r2 && r2.cards) { setSt(r2); setErr(""); }
          }).catch(function (e) { setErr("刷新失败: " + e); });
        }).then(function () { setSyncing(false); }, function () { setSyncing(false); });
      }
      useEffect(function () {
        load(false);
        fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) { if (s && s.role) setMyRole(s.role); if (s && typeof s.wipLimit === "number") setWipLimit(s.wipLimit); }).catch(function () {});
        var t = setInterval(function () { load(false); }, REFRESH_MS);
        return function () { clearInterval(t); };
      }, []);

      function depsOf(card) {
        return (card.deps || "").replace(/[\[\]']/g, "").split(",").map(function (s) { return s.trim(); }).filter(function (x) { return x; });
      }
      function depsPending(card, all) {
        return depsOf(card).filter(function (d) {
          var dep = all.find(function (c) { return c.id === d; });
          return !dep || dep.status !== "done";
        });
      }

      function act(id, patch) {
        apiCall("PUT", "/api/tasks", { id: id, ...patch }).then(function (r) {
          if (r.ok) { load(); setDetail(null); } else { setErr(r.error || "操作失败"); }
        });
      }
      function del(id) {
        if (!confirm("删除任务卡 " + id + "？")) return;
        apiCall("DELETE", "/api/tasks", { id: id }).then(function (r) {
          if (r.ok) { load(); setDetail(null); } else { setErr(r.error || "删除失败"); }
        });
      }
      function create() {
        if (!title.trim()) { setErr("标题必填"); return; }
        var depsArr = depsIn.split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(function (x) { return x; });
        apiCall("POST", "/api/tasks", { title: title.trim(), owner: owner, priority: priority, deps: depsArr, desc: desc.trim() }).then(function (r) {
          if (r.ok) { setCreating(false); setTitle(""); setDesc(""); setDepsIn(""); load(); } else { setErr(r.error || "创建失败"); }
        });
      }

      var cards = (st.cards || []).slice().sort(function (a, b) {
        var pa = (a.priority || "P1").slice(1), pb = (b.priority || "P1").slice(1);
        return pa === pb ? String(a.id).localeCompare(String(b.id)) : pa - pb;
      });
      var visible = filter === "mine" ? cards.filter(function (c) { return c.owner === myRole; })
        : filter === "inbox" ? cards.filter(function (c) { return c.origin && c.status === "todo"; })
        : cards;
      var detailCard = detail ? cards.find(function (c) { return c.id === detail; }) : null;
      var pendingDeps = detailCard ? depsPending(detailCard, cards) : [];
      var canAct = detailCard ? (myRole === "modeler" || detailCard.owner === myRole) : false;

      var board = COLS.map(function (c) {
        var items = visible.filter(function (x) { return x.status === c[0]; });
        return el("div", { className: "mmcas-col", key: c[0] },
          el("div", { className: "mmcas-col-head" },
            el("span", { className: "mmcas-dot", style: { background: c[2] } }),
            c[1], el("span", { className: "n" }, String(items.length))
          ),
          el("div", { className: "mmcas-col-body" },
            items.map(function (card) {
              var wait = card.status === "todo" ? depsPending(card, cards) : [];
              return el("div", { className: "mmcas-card", key: card.id, onClick: function () { setDetail(card.id); } },
                el("div", { className: "t" }, card.id + " · " + (card.title || "")),
                el("div", { className: "m" },
                  el("span", { style: { fontWeight: 700, color: card.priority === "P0" ? "#ff7d6b" : card.priority === "P1" ? "#ffb84d" : "inherit" } }, card.priority || "P1"),
                  avatar(card.owner),
                  card.updated || card.created || "",
                  wait.length ? "⏳ 等待 " + wait.join(",") : ""
                )
              );
            })
          )
        );
      });

      return el(Fragment, null,
        el("div", { className: "mmcas-row" },
          myRole === "modeler" ? el("button", { className: "mmcas-btn-primary", onClick: function () { setCreating(!creating); setDetail(null); } }, creating ? "收起表单" : "新建任务") : null,
          el("button", { className: filter === "all" ? "mmcas-btn-primary" : "mmcas-btn-ghost", onClick: function () { setFilter("all"); } }, "全部"),
          el("button", { className: filter === "mine" ? "mmcas-btn-primary" : "mmcas-btn-ghost", onClick: function () { setFilter("mine"); } }, "我的任务"),
          myRole === "modeler" ? el("button", { className: filter === "inbox" ? "mmcas-btn-primary" : "mmcas-btn-ghost", onClick: function () { setFilter("inbox"); } }, "收件箱") : null,
          myRole === "modeler" ? null : el("button", { className: "mmcas-btn-ghost", onClick: function () { var t = window.prompt("问题卡标题（简述要裁决或上报的问题）:", ""); if (!t || !t.trim()) return; var d = window.prompt("问题描述（上下文/证据）:", ""); apiCall("POST", "/api/backcard", { title: t.trim(), desc: (d || "").trim() }).then(function (r) { if (r && r.ok) { window.alert("已提交回程卡 " + r.id); load(); } else setErr((r && r.error) || "提交失败"); }); } }, "提交问题卡"),
          el("button", { className: "mmcas-btn-ghost", onClick: function () { load(true); }, title: "立即拉取 git 远端（coder/writer 的卡变更）并刷新看板" }, syncing ? "同步中…" : "刷新"),
          el("span", { className: "mmcas-sync", style: { marginLeft: "auto", fontSize: "11px", whiteSpace: "nowrap" } },
            ["modeler", "coder", "writer"].map(function (r) {
              var n = (st.cards || []).filter(function (c) { return c.status === "doing" && c.owner === r; }).length;
              return r.slice(0, 1).toUpperCase() + " " + n + (wipLimit > 0 ? "/" + wipLimit : "");
            }).join("  "))
        ),
        err ? el("div", { className: "mmcas-empty" }, err) : null,
        el("div", { className: "mmcas-sync " + (sync && sync.ok === false ? "warn" : ""), style: { margin: "2px 0 8px" } },
          "看板每 " + Math.round(REFRESH_MS / 1000) + " 秒自动同步 git · " + syncText(sync)),
        creating ? el("div", { className: "mmcas-detail" },
          el("h4", null, "新建任务"),
          el("div", { className: "mmcas-row" },
            el("input", { className: "mmcas-input", placeholder: "任务标题", value: title, onChange: function (e) { setTitle(e.target.value); } }),
            el("select", { className: "mmcas-select", style: { width: "110px", flex: "none" }, value: owner, onChange: function (e) { setOwner(e.target.value); } },
              el("option", { value: "modeler" }, "建模手 M"),
              el("option", { value: "coder" }, "编程手 C"),
              el("option", { value: "writer" }, "论文手 W")
            ),
            el("select", { className: "mmcas-select", style: { width: "90px", flex: "none" }, value: priority, onChange: function (e) { setPriority(e.target.value); } },
              el("option", { value: "P0" }, "P0"),
              el("option", { value: "P1" }, "P1"),
              el("option", { value: "P2" }, "P2")
            )
          ),
          el("input", { className: "mmcas-input", placeholder: "依赖任务 id（逗号分隔，如 T-001,T-002）", value: depsIn, onChange: function (e) { setDepsIn(e.target.value); } }),
          el("textarea", { className: "mmcas-textarea", placeholder: "目标说明与验收标准（可选）", value: desc, onChange: function (e) { setDesc(e.target.value); } }),
          el("div", { className: "mmcas-row", style: { marginTop: "8px" } },
            el("button", { className: "mmcas-btn-primary", onClick: create }, "创建"),
            el("button", { className: "mmcas-btn-ghost", onClick: function () { setCreating(false); } }, "取消")
          )
        ) : null,
        el("div", { className: "mmcas-board" }, board),
        detailCard ? el("div", { className: "mmcas-detail" },
          el("h4", null, detailCard.id + " · " + detailCard.title),
          pendingDeps.length ? el("div", { className: "mmcas-sync warn" }, "⏳ 等待依赖完成: " + pendingDeps.join(", ")) : null,
          editing ? el("div", null,
            el("div", { className: "mmcas-row" },
              el("input", { className: "mmcas-input", placeholder: "标题", value: form.title, onChange: function (e) { setForm({ ...form, title: e.target.value }); } }),
              el("select", { className: "mmcas-select", style: { width: "110px", flex: "none" }, value: form.owner, onChange: function (e) { setForm({ ...form, owner: e.target.value }); } },
                el("option", { value: "modeler" }, "建模手 M"),
                el("option", { value: "coder" }, "编程手 C"),
                el("option", { value: "writer" }, "论文手 W")
              ),
              el("select", { className: "mmcas-select", style: { width: "90px", flex: "none" }, value: form.priority, onChange: function (e) { setForm({ ...form, priority: e.target.value }); } },
                el("option", { value: "P0" }, "P0"),
                el("option", { value: "P1" }, "P1"),
                el("option", { value: "P2" }, "P2")
              )
            ),
            el("input", { className: "mmcas-input", placeholder: "依赖任务 id（逗号分隔，如 T-001,T-002）", value: form.deps, onChange: function (e) { setForm({ ...form, deps: e.target.value }); } }),
            el("textarea", { className: "mmcas-textarea", placeholder: "目标说明与验收标准", value: form.desc, onChange: function (e) { setForm({ ...form, desc: e.target.value }); } }),
            el("div", { className: "mmcas-row", style: { marginTop: "8px" } },
              el("button", { className: "mmcas-btn-primary", onClick: function () { act(detailCard.id, { title: form.title, owner: form.owner, priority: form.priority, deps: form.deps.split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(function (x) { return x; }), desc: form.desc }); setEditing(false); } }, "保存"),
              el("button", { className: "mmcas-btn-ghost", onClick: function () { setEditing(false); } }, "取消")
            )
          ) : el("div", { className: "bd" }, detailCard.body || "（无正文）"),
          el("div", { className: "mmcas-actions" },
            canAct && detailCard.status === "todo" && pendingDeps.length === 0 ? el("button", { className: "mmcas-btn-primary", onClick: function () { act(detailCard.id, { status: "doing" }); } }, "开始") : null,
            canAct && detailCard.status === "doing" ? el("button", { className: "mmcas-btn-primary", onClick: function () { act(detailCard.id, { status: "done" }); } }, "完成") : null,
            canAct && detailCard.status === "doing" ? el("button", { className: "mmcas-btn-ghost", onClick: function () { act(detailCard.id, { status: "todo" }); } }, "退回待办") : null,
            canAct && detailCard.status === "done" ? el("button", { className: "mmcas-btn-ghost", onClick: function () { var rr = window.prompt("打回原因（必填）:", ""); if (rr && rr.trim()) { apiCall("PUT", "/api/tasks", { id: detailCard.id, status: "todo", reason: rr.trim() }).then(function (r) { if (r && r.ok) { if (r.warning) window.alert(r.warning); load(); setDetail(null); } else setErr((r && r.error) || "打回失败"); }); } } }, "打回（需填原因）") : null,
            myRole === "modeler" && detailCard.origin && detailCard.status === "todo" ? el("button", { className: "mmcas-btn-primary", onClick: function () { var t = window.prompt("正式卡标题（默认沿用原题）:", detailCard.title || ""); if (!t || !t.trim()) return; apiCall("POST", "/api/tasks", { title: t.trim(), owner: "coder", priority: "P1", deps: [], desc: "由回程卡 " + detailCard.id + " 转入。\n\n" + (detailCard.body || "").slice(0, 300) }).then(function (r) { if (r && r.ok) { apiCall("PUT", "/api/tasks", { id: detailCard.id, status: "done" }).then(function () { load(); setDetail(null); }); } else setErr((r && r.error) || "转卡失败"); }); } }, "转正式卡") : null,
            myRole === "modeler" && detailCard.status !== "done" ? el("button", { className: "mmcas-btn-danger", onClick: function () { var why = window.prompt("停止该方向（向 " + detailCard.owner + " 端发送紧急 stop，scope=" + detailCard.id + "）。原因/说明（可选）:", ""); if (why === null) return; apiCall("POST", "/api/notices", { to: detailCard.owner, kind: "stop", urgency: "urgent", scope: detailCard.id, body: (why || "").trim() || ("停止 " + detailCard.id + " 方向的后续工作") }).then(function (r) { if (r && r.ok) { window.alert("已发送停止指令 " + r.id); } else setErr((r && r.error) || "发送失败"); }); } }, "停止该方向") : null,
            canAct && !editing ? el("button", { className: "mmcas-btn-ghost", onClick: function () { setForm({ title: detailCard.title || "", owner: detailCard.owner || "coder", priority: detailCard.priority || "P1", deps: depsOf(detailCard).join(","), desc: (detailCard.body || "").split("## 产出物")[0].replace("## 目标", "").trim() }); setEditing(true); } }, "编辑") : null,
            canAct ? el("button", { className: "mmcas-btn-danger", onClick: function () { del(detailCard.id); } }, "删除") : null,
            el("button", { className: "mmcas-btn-ghost", onClick: function () { setDetail(null); setEditing(false); } }, "关闭")
          )
        ) : null
      );
    }

    // ---------- 视图: 审计室（v1.2 W4） ----------
    function AuditRoom() {
      var _d = useState("model"), dim = _d[0], setDim = _d[1];
      var _s = useState(null), st = _s[0], setSt = _s[1];
      var _h = useState(null), bh = _h[0], setBh = _h[1];
      var _cf = useState(null), cfg = _cf[0], setCfg = _cf[1];
      var _sc = useState(false), showCfg = _sc[0], setShowCfg = _sc[1];
      var _ed = useState(null), edit = _ed[0], setEdit = _ed[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _m = useState(""), msg = _m[0], setMsg = _m[1];
      var _nt = useState(""), note = _nt[0], setNote = _nt[1];
      function loadStatus() {
        fetch(API + "/api/audit/status").then(function (r) { return r.json(); }).then(function (s) { setSt(s); }).catch(function () {});
        fetch(API + "/api/bridge/health").then(function (r) { return r.json(); }).then(function (b) { setBh(b); }).catch(function () {});
        fetch(API + "/api/audit/config").then(function (r) { return r.json(); }).then(function (c) { setCfg(c); }).catch(function () {});
      }
      useEffect(function () { loadStatus(); var t = setInterval(loadStatus, 5000); return function () { clearInterval(t); }; }, []);
      // cfg 到货后自动填充编辑表单（首次）
      useEffect(function () {
        if (cfg && cfg.ok && !edit) setEdit({ endpoint: cfg.endpoint, model: cfg.model, protocol: cfg.protocol, maxFeeCny: cfg.maxFeeCny, apiKeyEnv: cfg.apiKeyEnv, apiKey: "" });
      }, [cfg]);
      function saveCfg() {
        var e = edit || {};
        apiCall("PUT", "/api/audit/config", { endpoint: e.endpoint, model: e.model, protocol: e.protocol, maxFeeCny: e.maxFeeCny, apiKey: e.apiKey || undefined, apiKeyEnv: e.apiKeyEnv }).then(function (r) {
          if (r && r.ok) { setMsg("Reviewer 配置已保存（填写了 key 则已写入 credentials）"); setEdit(null); setShowCfg(false); loadStatus(); }
          else setMsg((r && r.error) || "配置保存失败");
        }).catch(function (x) { setMsg(String(x)); });
      }
      function start(confirm) {
        setBusy(true); setMsg("");
        apiCall("POST", "/api/audit", { dimension: dim, confirm: !!confirm, note: note }).then(function (r) {
          setBusy(false);
          if (r && r.ok && r.started) { setMsg("审阅已启动：" + r.id + "（约 2–5 分钟，可关闭本抽屉）"); loadStatus(); }
          else if (r && r.needsConfirm) {
            if (window.confirm("预估费用 ≈ ¥" + r.est.estFee + "（" + r.est.files + " 文件 / " + Number(r.est.chars).toLocaleString() + " 字符）——超过阈值。继续？")) start(true);
          } else setMsg((r && r.error) || "启动失败");
        }).catch(function (e) { setBusy(false); setMsg(String(e)); });
      }
      var running = st && st.running;
      var res = st && st.result;
      return el(Fragment, null,
        el("div", { className: "mmcas-row" },
          el("div", { className: "mmcas-sec", style: { flex: 1, marginBottom: 0 } }, "Reviewer（审阅人）· 第四方审阅实例"),
          el("button", { className: "mmcas-btn-mini", onClick: function () { setShowCfg(!showCfg); } }, showCfg ? "收起配置" : "配置 ▾")
        ),
        el("div", { className: "mmcas-empty" }, cfg && cfg.ok
          ? ("通道：" + cfg.model + " @ " + cfg.endpoint + "（" + cfg.protocol + "）· key " + (cfg.hasKey ? "已配置" : "未配置") + " · 阈值 ¥" + cfg.maxFeeCny + " · 源:" + cfg.source)
          : (cfg ? ("配置读取失败：" + (cfg.error || "未知")) : "配置读取中…")),
        showCfg && edit ? el("div", { className: "mmcas-mem" },
          el("div", { className: "mmcas-row" }, el("span", { className: "mmcas-label" }, "Endpoint"), el("input", { className: "mmcas-input", value: edit.endpoint || "", onChange: function (ev) { setEdit(Object.assign({}, edit, { endpoint: ev.target.value })); } })),
          el("div", { className: "mmcas-row" }, el("span", { className: "mmcas-label" }, "模型名"), el("input", { className: "mmcas-input", value: edit.model || "", onChange: function (ev) { setEdit(Object.assign({}, edit, { model: ev.target.value })); } })),
          el("div", { className: "mmcas-row" },
            el("span", { className: "mmcas-label" }, "协议"), el("select", { className: "mmcas-select", style: { width: "130px", flex: "none" }, value: edit.protocol || "responses", onChange: function (ev) { setEdit(Object.assign({}, edit, { protocol: ev.target.value })); } },
              el("option", { value: "responses" }, "responses"), el("option", { value: "chat" }, "chat/completions")),
            el("span", { className: "mmcas-label" }, "阈值¥"), el("input", { className: "mmcas-input", style: { width: "70px", flex: "none" }, value: edit.maxFeeCny || 30, onChange: function (ev) { setEdit(Object.assign({}, edit, { maxFeeCny: ev.target.value })); } })),
          el("div", { className: "mmcas-row" }, el("span", { className: "mmcas-label" }, "API Key"), el("input", { className: "mmcas-input", type: "password", placeholder: "填写后写入 credentials（不回显）", value: edit.apiKey || "", onChange: function (ev) { setEdit(Object.assign({}, edit, { apiKey: ev.target.value })); } })),
          el("div", { className: "mmcas-row" },
            el("button", { className: "mmcas-btn-primary", onClick: saveCfg }, "保存配置"),
            el("button", { className: "mmcas-btn-mini", onClick: function () { setEdit({ endpoint: cfg.endpoint, model: cfg.model, protocol: cfg.protocol, maxFeeCny: cfg.maxFeeCny, apiKeyEnv: cfg.apiKeyEnv, apiKey: "" }); } }, "重置表单")),
          el("div", { className: "mmcas-empty" }, "写入 dsh settings.yaml 的 reviewer 段（key 存 .credentials.yaml）。默认通道为本地桥（3220）；换别家专家模型：改 endpoint + model（+key）即可。")
        ) : null,
        el("div", { className: "mmcas-sec" }, "发起审阅"),
        el("div", { className: "mmcas-row" },
          el("select", { className: "mmcas-select", style: { width: "150px", flex: "none" }, value: dim, onChange: function (e) { setDim(e.target.value); } },
            el("option", { value: "model" }, "数学模型"),
            el("option", { value: "code" }, "代码成品"),
            el("option", { value: "paper" }, "最终论文")),
          el("button", { className: "mmcas-btn-primary", disabled: busy || running, onClick: function () { start(false); } }, running ? "审阅中…" : "开始审阅")
        ),
        el("div", { className: "mmcas-row" },
          el("textarea", { className: "mmcas-input", style: { minHeight: "44px" }, placeholder: "补充说明（可选，随材料一起提交：本轮审阅重点 / 跨文件提醒）", value: note, onChange: function (ev) { setNote(ev.target.value); } })
        ),
        msg ? el("div", { className: "mmcas-empty" }, msg) : null,
        running ? el("div", { className: "mmcas-sync" }, "运行中：" + st.dimension + " · 启动于 " + st.startedAt) : null,
        res ? el("div", { className: "mmcas-mem" },
          res.ok
            ? ("✓ " + res.dimension + " 审阅完成 · " + res.elapsedS + "s · ≈¥" + res.estFee + (res.usage ? (" · in=" + (res.usage.input_tokens || "?") + " out=" + (res.usage.output_tokens || "?")) : ""))
            : ("✗ " + (res.error || "失败")),
          res.ok && res.reportPath ? el("div", { className: "r" }, String(res.reportPath)) : null,
          res.ok && res.notice ? el("div", { className: "r" }, "通知已发送: " + res.notice) : null
        ) : null,
        bh ? el("div", { className: "mmcas-empty" + ((bh.ok && bh.bridge && !bh.bridge.lastUpstreamError) ? "" : " warn") },
          bh.ok
            ? ("桥：在线 · " + ((bh.bridge.models || []).join("/")) +
              (bh.bridge.lastUpstreamError
                ? (" · ⚠ 最近上游错误 " + (bh.bridge.lastUpstreamError.status || "?") + "（" + String(bh.bridge.lastUpstreamError.at || "").slice(0, 19) + "）")
                : (bh.bridge.lastSuccessAt ? (" · 最近成功 " + String(bh.bridge.lastSuccessAt).slice(0, 19)) : " · 尚无调用记录")))
            : ("桥：✗ " + (bh.error || "不可达") + "（默认通道将失败；检查 3220 或改配置走外部端点）")) : null,
        el("div", { className: "mmcas-empty" }, "报告落盘于工作区 audit/ 目录。")
      );
    }

    // ---------- 视图: 共享记忆 ----------
    function Memory() {
      var _s = useState(null), state = _s[0], setState = _s[1];
      useEffect(function () {
        var alive = true;
        function load() { fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) { if (alive) setState(s); }).catch(function () {}); }
        load();
        var t = setInterval(load, REFRESH_MS);
        return function () { alive = false; clearInterval(t); };
      }, []);
      var mems = (state && state.memory) || [];
      if (!mems.length) return el("div", { className: "mmcas-empty" }, "暂无记忆条目（用 memory-log 写入，git 同步共享）");
      return el(Fragment, null,
        mems.map(function (m, i) {
          var rc = ROLE_C[m.role] || "#8a94a6";
          return el("div", { className: "mmcas-mem", key: i },
            el("span", { style: { color: rc, fontWeight: 600 } }, "[" + (ROLE_I[m.role] || "?") + "] "),
            m.body,
            el("div", { className: "r" }, m.date + " " + m.time)
          );
        })
      );
    }

    // ---------- 抽屉壳 ----------
    function Drawer(props) {
      var title = props.panel === "overview" ? "总控" : props.panel === "board" ? "任务看板" : props.panel === "audit" ? "审阅室" : "共享记忆";
      var body = props.panel === "overview" ? el(Overview)
        : props.panel === "board" ? el(Board)
        : props.panel === "audit" ? el(AuditRoom)
        : el(Memory);
      return el(Fragment, null,
        el("div", { className: "mmcas-mask", onClick: props.onClose }),
        el("div", { className: "mmcas-drawer" },
          el("div", { className: "mmcas-head" },
            el("h3", null, "MMCAS · " + title),
            el("button", { className: "mmcas-close", onClick: props.onClose }, "✕")
          ),
          el("div", { className: "mmcas-body" }, body)
        )
      );
    }

    function Btn(props) {
      return el("button", {
        className: "mmcas-btn",
        "aria-label": "MMCAS " + props.label,
        title: "MMCAS " + props.label,
        onClick: props.onClick
      },
        el("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" },
          React.createElement(props.icon, null)
        ),
        props.label
      );
    }
    var ICONS = {
      overview: "g", board: "b", memory: "m"
    };
    function iconShape(kind) {
      if (kind === "board") return el(Fragment, null,
        el("rect", { x: "3", y: "3", width: "7", height: "14", rx: "2" }),
        el("rect", { x: "14", y: "3", width: "7", height: "9", rx: "2" }),
        el("rect", { x: "14", y: "16", width: "7", height: "5", rx: "2" }));
      if (kind === "memory") return el(Fragment, null,
        el("circle", { cx: "12", cy: "12", r: "9" }),
        el("path", { d: "M12 7v5l3 2" }));
      if (kind === "audit") return el(Fragment, null,
        el("path", { d: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" }),
        el("path", { d: "M9 12l2 2 4-4" }));
      return el(Fragment, null,
        el("rect", { x: "4", y: "5", width: "16", height: "10", rx: "2" }),
        el("path", { d: "M8 19h8M12 15v4" }));
    }

    function TriggerGroup() {
      var _p = useState(null), panel = _p[0], setPanel = _p[1];
      var _r = useState("modeler"), role = _r[0], setRole = _r[1];

      useEffect(function () {
        // 读角色：Master 显示总控+看板+记忆；Slave 仅看板+记忆
        fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) {
          if (s && s.role) setRole(s.role);
        }).catch(function () {});
      }, []);

      function openPanel(k) { setPanel(panel === k ? null : k); }

      useEffect(function () {
        // 把按钮组移动到 New Session 按钮下方
        function relocate() {
          var wrap = document.querySelector("[data-mmcas-btns]");
          if (!wrap) return;
          var ns = Array.prototype.slice.call(document.querySelectorAll("button")).find(function (b) {
            return b.textContent.trim().toLowerCase() === "new session" || b.textContent.trim() === "New Session";
          });
          if (!ns) return;
          if (ns.nextSibling === wrap) return;
          ns.parentNode.insertBefore(wrap, ns.nextSibling);
        }
        relocate();
        var mo = new MutationObserver(relocate);
        mo.observe(document.body, { childList: true, subtree: true });
        return function () { mo.disconnect(); };
      }, []);

      var btn = function (kind, label) {
        return el(Btn, {
          key: kind, label: label, icon: function () { return iconShape(kind); },
          onClick: function () { openPanel(kind); }
        });
      };

      // 角色感知：全员四按钮（总控/看板/记忆/审阅室）；总控抽屉内按角色分级（操控门户仅 Master）
      var buttons = [btn("overview", "总控"), btn("board", "任务看板"), btn("memory", "共享记忆"), btn("audit", "审阅室")];

      return el(Fragment, null,
        el("div", { className: "mmcas-wrap", "data-mmcas-btns": "1" }, buttons),
        panel ? el(Drawer, { panel: panel, onClose: function () { setPanel(null); } }) : null
      );
    }

    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({
          name: "sidebar.footer.action",
          id: "mmcas.command-center",
          order: 100,
          inject: function () { return {}; }
        }, TriggerGroup);
      });
    }

    return { apply: apply, inject: ["slots"] };
  }
});
