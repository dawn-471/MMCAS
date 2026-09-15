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

    // ---------- 视图: 总控 ----------
    function Overview() {
      var _s = useState(null), state = _s[0], setState = _s[1];
      var _c = useState(""), cmd = _c[0], setCmd = _c[1];
      var _r = useState(null), roleSel = _r[0], setRoleSel = _r[1];
      var _o = useState(null), out = _o[0], setOut = _o[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];

      useEffect(function () {
        var alive = true;
        function load() { fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) { if (alive) setState(s); }).catch(function () {}); }
        load();
        var t = setInterval(load, 15000);
        return function () { alive = false; clearInterval(t); };
      }, []);

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
        el("div", { className: "mmcas-empty" },
          pollerState && pollerState.enabled
            ? "轮询中（每 " + (pollerState.intervalSec || 120) + " 秒）· 上次检测 " + (pollerState.lastRun ? new Date(pollerState.lastRun).toLocaleTimeString() : "—") + (pollerState.lastFound && pollerState.lastFound.length ? " · 最近发现: " + pollerState.lastFound.join(",") : "")
            : "已关闭——agent 仅在能工智人发话时接取任务"
        )
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
        syncUi,
        controlPortal,
        el("div", { className: "mmcas-sec" }, "同步水位"),
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
      var _ed = useState(false), editing = _ed[0], setEditing = _ed[1];
      var _ef = useState({ title: "", owner: "coder", priority: "P1", deps: "", desc: "" }), form = _ef[0], setForm = _ef[1];

      function load() { apiCall("GET", "/api/tasks").then(function (r) { setSt(r); setErr(""); }).catch(function (e) { setErr(String(e)); }); }
      useEffect(function () {
        load();
        fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) { if (s && s.role) setMyRole(s.role); }).catch(function () {});
        var t = setInterval(load, 10000);
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
      var visible = filter === "mine" ? cards.filter(function (c) { return c.owner === myRole; }) : cards;
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
          el("button", { className: "mmcas-btn-ghost", onClick: load }, "刷新"),
          el("span", { className: "mmcas-sync", style: { marginLeft: "auto", fontSize: "11px", whiteSpace: "nowrap" } },
            ["modeler", "coder", "writer"].map(function (r) {
              var n = (st.cards || []).filter(function (c) { return c.status === "doing" && c.owner === r; }).length;
              return r.slice(0, 1).toUpperCase() + " " + n + "/2";
            }).join("  "))
        ),
        err ? el("div", { className: "mmcas-empty" }, err) : null,
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
            canAct && detailCard.status === "done" ? el("button", { className: "mmcas-btn-ghost", onClick: function () { act(detailCard.id, { status: "doing" }); } }, "打回进行中") : null,
            canAct && !editing ? el("button", { className: "mmcas-btn-ghost", onClick: function () { setForm({ title: detailCard.title || "", owner: detailCard.owner || "coder", priority: detailCard.priority || "P1", deps: depsOf(detailCard).join(","), desc: (detailCard.body || "").split("## 产出物")[0].replace("## 目标", "").trim() }); setEditing(true); } }, "编辑") : null,
            canAct ? el("button", { className: "mmcas-btn-danger", onClick: function () { del(detailCard.id); } }, "删除") : null,
            el("button", { className: "mmcas-btn-ghost", onClick: function () { setDetail(null); setEditing(false); } }, "关闭")
          )
        ) : null
      );
    }

    // ---------- 视图: 共享记忆 ----------
    function Memory() {
      var _s = useState(null), state = _s[0], setState = _s[1];
      useEffect(function () {
        var alive = true;
        function load() { fetch(API + "/api/state").then(function (r) { return r.json(); }).then(function (s) { if (alive) setState(s); }).catch(function () {}); }
        load();
        var t = setInterval(load, 15000);
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
      var title = props.panel === "overview" ? "总控" : props.panel === "board" ? "任务看板" : "共享记忆";
      var body = props.panel === "overview" ? el(Overview)
        : props.panel === "board" ? el(Board)
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

      // 角色感知：全员三按钮；总控抽屉内按角色分级（操控门户仅 Master）
      var buttons = [btn("overview", "总控"), btn("board", "任务看板"), btn("memory", "共享记忆")];

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
