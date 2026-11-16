(function(root) {
  function startRoomUI(platform, Client, back, invitedCode) {
    const ctx = platform.canvas.getContext('2d');
    const C = { paper: '#f3efdf', ink: '#262d28', muted: '#798074', red: '#cc4735', white: '#fffcf3', line: '#d8d4c4', green: '#526c4a' };
    let buttons = [], scale = 1, ox = 0, oy = 0, closed = false, busy = false, error = '', message = '', messageUntil = 0, draft = '', roundKey = '', confirmLeave = false;
    let entryMode = invitedCode ? 'join' : 'create', selected = null, showModes = false, showConnection = false, showFact = false, draftIdentity = '', connectionOriginal = '';
    let name = platform.load('bluff-name') || '', code = invitedCode || '', base = platform.serverBase || platform.load('bluff-base') || '';
    const client = new Client(platform, render);
    const saved = platform.load('bluff-room');
    function text(s, x, y, size = 14, color = C.ink, bold = false, align = 'left') {
      ctx.fillStyle = color; ctx.font = `${bold ? 'bold' : 'normal'} ${size}px sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'top'; ctx.fillText(String(s), x, y);
    }
    function box(x, y, w, h, color = C.white) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
    function wrap(s, x, y, width, size = 15, color = C.ink, lineHeight = 23, limit = 4) {
      const lines = []; let row = ''; ctx.font = `${size}px sans-serif`;
      for (const ch of String(s)) {
        if (row && ctx.measureText(row + ch).width > width) { lines.push(row); row = ''; }
        row += ch;
      }
      if (row) lines.push(row);
      // 避免问号单独落在下一行，也让中文末行保持可读的长度。
      if (lines.length > 1) {
        const last = lines.length - 1, tail = [...lines[last]], prev = [...lines[last - 1]];
        if (tail.length < 4 && prev.length > 6) {
          const moved = prev.splice(prev.length - (4 - tail.length));
          lines[last - 1] = prev.join(''); lines[last] = moved.join('') + lines[last];
        }
      }
      lines.slice(0, limit).forEach((value, index) => text(value, x, y + index * lineHeight, size, color));
    }
    function button(label, x, y, w, fn, disabled = false, secondary = false, h = 46) {
      box(x, y, w, h, disabled ? '#d8d7ca' : secondary ? C.white : C.red);
      text(label, x + w / 2, y + (h - 16) / 2, 15, disabled || secondary ? C.ink : C.white, true, 'center');
      if (!disabled && !busy) buttons.push({ x, y, w, h, fn });
    }
    function note(value) { message = value; messageUntil = Date.now() + 3500; render(); }
    async function run(fn) {
      if (busy || closed) return;
      busy = true; error = ''; render();
      try { await fn(); } catch (e) { error = e.message || '操作失败，请重试。'; }
      finally { busy = false; render(); }
    }
    function action(type, payload) {
      if (!client.connected) { note('正在重连，请同步成功后再提交。'); client.poll(); return; }
      return run(() => client.action(type, payload));
    }
    function saveDraft(state, value) {
      draft = [...value].slice(0, 30).join('');
      platform.save('bluff-draft', { identity: `${client.base}:${state.code}:${state.self}:${state.roundId}`, text: draft });
    }
    function progress(state, key, y) {
      state.players.filter(p => !p.left).forEach((p, i) => {
        const x = 24 + (i % 3) * 116, top = y + Math.floor(i / 3) * 30;
        box(x, top, 110, 25, p[key] ? '#e5e9d9' : C.white);
        text(`${p[key] ? '✓' : p.online ? '·' : '○'} ${[...p.name].slice(0, 5).join('')}`, x + 8, top + 6, 11, p[key] ? C.green : C.muted);
      });
    }
    function input(value, title, maxLength, done, live = false) {
      platform.input(value, next => { if (!closed) { done(next); render(); } }, { title, maxLength, live });
    }
    function field(label, value, placeholder, y, title, max, set) {
      text(label, 24, y, 12, C.muted, true); box(24, y + 25, 342, 49);
      text(value.length > 30 ? value.slice(0, 29) + '…' : value || placeholder, 37, y + 40, 15, value ? C.ink : C.muted);
      if (!busy) buttons.push({ x: 24, y: y + 25, w: 342, h: 49, fn: () => input(value, title, max, set) });
    }
    function setup() {
      text('朋友入局，', 24, 133, 34, C.ink, true); text('看看谁最会编。', 24, 178, 34, C.ink, true);
      text('3–6 人 · 选好节奏，再一本正经地瞎编', 24, 233, 13, C.muted);
      button('我要组局', 24, 276, 163, () => { entryMode = 'create'; render(); }, false, entryMode !== 'create', 42);
      button('加入好友', 203, 276, 163, () => { entryMode = 'join'; render(); }, false, entryMode !== 'join', 42);
      field('你的鉴定员昵称', name, '大家怎么称呼你？', 346, '填写昵称（最多10字）', 10, value => { name = value; });
      if (entryMode === 'join') field('好友房间码', code, '输入朋友发来的六位房间码', 450, '填写六位房间码', 6, value => { code = value.replace(/\D/g, ''); });
      else {
        box(24, 450, 342, 74); text('先建一个房间，再把好友喊进来。', 39, 466, 16, C.ink, true);
        text('房主可以选择闪电局、经典局或慢慢编。', 39, 496, 12, C.muted);
      }
      const enter = () => run(async () => {
        if (!name.trim()) throw new Error('先填写你的昵称。');
        if (entryMode === 'join' && !/^\d{6}$/.test(code)) throw new Error('请填写六位房间码。');
        client.configure(base); platform.save('bluff-name', name.trim()); platform.save('bluff-base', base.trim());
        await client.enter(name.trim(), entryMode === 'join' ? code : undefined);
      });
      button(entryMode === 'create' ? '创建我的房间 →' : '进房间，一起瞎掰 →', 24, 559, 342, enter, !base);
      if (platform.load('bluff-room') && !client.session) button('恢复上次的房间', 24, 625, 342, () => run(() => client.resume(platform.load('bluff-room'))), false, true, 40);
      else wrap(entryMode === 'create' ? '全员准备后开局。猜中真相得2分，骗到好友每人得1分。' : '进入同一个房间，准备好后等房主开局。', 24, 633, 342, 13, C.muted, 22, 2);
      button(base ? '连接设置' : '先配置联机服务', 24, 723, 342, () => { connectionOriginal = base; showConnection = true; render(); }, false, true, 38);
    }
    function recovery() {
      text('正在找回你的房间', 24, 163, 27, C.ink, true);
      text(`房间 ${client.session.code}`, 24, 214, 18, C.red, true);
      wrap('你的身份已保留。网络恢复后会自动同步最新进度，请勿重复创建房间。', 24, 284, 342, 17, C.muted, 29);
      button('立即重试', 24, 480, 342, () => client.poll());
      button('返回首页，稍后再试', 24, 544, 342, back, false, true);
    }
    function memberRows(state, start, step = 61, ranking = false) {
      const players = ranking ? state.players.slice().sort((a, b) => b.score - a.score) : state.players;
      players.forEach((p, i) => {
        const y = start + step * i; box(24, y, 342, step - 6, p.id === state.self ? '#e5e9d9' : C.white);
        text(ranking ? String(i + 1).padStart(2, '0') : p.id === state.host ? '主' : String(i + 1).padStart(2, '0'), 36, y + 15, 14, C.red, true);
        text(p.name + (p.id === state.self ? ' · 你' : ''), 74, y + 9, 15, C.ink, true);
        text(ranking ? `猜对 ${p.hits} · 骗到 ${p.fooled} · 笑脸 ${p.laughs}` : p.left ? '已离开' : p.online ? '在线' : '暂时掉线，可重连', 74, y + 33, 10, C.muted);
        text(ranking ? `${p.score} 分` : p.ready ? '已准备' : '未准备', 352, y + 19, 13, p.ready ? C.green : C.muted, true, 'right');
        if (!ranking && !p.online && state.self === state.host && p.id !== state.self) {
          text('点击移除', 352, y + 38, 9, C.red, false, 'right');
          if (!busy) buttons.push({ x: 24, y, w: 342, h: step - 6, fn: () => action('remove', { playerId: p.id }) });
        }
      });
    }
    function invite(state) {
      if (platform.shareRoom) platform.shareRoom(state.code);
      else platform.copy(`来《瞎掰大王》一起瞎编！房间码：${state.code}\n${client.base}/preview.html?room=${state.code}`, () => note(/https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(client.base) ? '已复制；跨设备请改用电脑的同 Wi-Fi 地址' : '邀请链接已复制，发给好友即可'));
    }
    function lobby(state) {
      text('瞎掰小分队', 24, 132, 29, C.ink, true); text('房间码', 24, 181, 12, C.muted);
      text(state.code.split('').join(' '), 24, 204, 37, C.red, true);
      button('邀请好友', 251, 187, 115, () => invite(state), false, true, 42);
      text(`${state.players.length} / 6 人到场 · 点击房间码可复制`, 24, 250, 12, C.muted);
      if (!busy) buttons.push({ x: 24, y: 181, w: 220, h: 63, fn: () => platform.copy(state.code, () => note('房间码已复制')) });
      const settings = state.settings || { name: '经典局', writeSeconds: 60, voteSeconds: 30 };
      button(`${settings.name} · ${state.total}轮 · 编${settings.writeSeconds}秒 / 猜${settings.voteSeconds}秒`, 24, 276, 342, () => { showModes = true; render(); }, false, true, 38);
      memberRows(state, 327, 46);
      text(`全员未见 ${state.freshCount ?? '—'} / ${state.bankSize ?? '—'} 道 · 旧题不循环`, 24, 620, 12, C.green);
      text(state.identityKind === 'wechat' ? '微信账号记录 · 换设备也能避开旧题' : '游客记录 · 换房保留，清除数据会丢失身份', 24, 645, 11, C.muted);
      const me = state.players.find(p => p.id === state.self), host = state.self === state.host;
      button(me.ready ? '取消准备' : '我准备好了', 24, 680, host ? 163 : 342, () => action('ready', { ready: !me.ready }), false, me.ready);
      if (host) button('开始鉴定 →', 203, 680, 163, () => action('start'), state.canStartFresh === false || state.players.length < 3 || !state.players.every(p => p.ready && p.online));
      text(state.canStartFresh === false ? '新题不足：切换短局，或等待题库更新。' : state.players.length < 3 ? '不足3人？邀请好友一起加入。' : state.players.every(p => p.ready && p.online) ? '全员就绪，房主可以开始鉴定。' : '等每位玩家准备好，再一起开局。', 24, 743, 12, C.muted);
    }
    function title(state, label) {
      text(`档案 ${String(state.round).padStart(2, '0')} / ${state.total}`, 24, 126, 12, C.muted, true);
      text(label, 366, 126, 12, C.red, true, 'right');
      text(state.question.tag, 24, 163, 12, C.green, true);
      wrap(state.question.q, 24, 188, 342, 23, C.ink, 31, 3);
    }
    function countdown(state) { return Math.max(0, Math.ceil((state.deadline - client.now()) / 1000)); }
    function write(state) {
      title(state, `编证词 · ${countdown(state)}s`);
      box(24, 316, 342, 153);
      wrap(state.answered ? state.myAnswer || '已启用系统补位，本轮不获得骗人分。' : draft || '点这里，编一句看起来很真的答案…', 40, 339, 308, 18, draft || state.answered ? C.ink : C.muted, 29, 3);
      text(`${[...(state.answered ? state.myAnswer : draft)].length} / 30`, 350, 445, 11, C.muted, false, 'right');
      if (!state.answered && !busy) buttons.push({ x: 24, y: 316, w: 342, h: 153, fn: () => input(draft, '编一句假答案（最多30字）', 30, value => { if (client.state?.phase === 'write' && client.state.roundId === state.roundId) saveDraft(state, value); }, true) });
      text(`已收到 ${state.submitted} / ${state.activeCount || state.players.length} 份证词`, 24, 498, 15, C.green, true);
      wrap(state.answered ? '证词已锁定，等大家交卷后一起辨认真相。' : draft ? '草稿已自动保存在本机，刷新也能找回。' : '灵感：像人名？像暗号？编个正经解释。', 24, 532, 342, 14, C.muted);
      progress(state, 'answered', 576);
      button(state.answered ? '等待其他玩家…' : '提交证词 →', 24, 649, 342, () => action('answer', { text: draft }), state.answered || !client.connected);
      if (!state.answered) button('脑袋空空，系统补位', 24, 712, 342, () => action('answer', { skip: true }), !client.connected, true, 42);
    }
    function choices(state, reveal) {
      const total = state.options.length, height = total > 5 ? 51 : 64, gap = 5, top = 290;
      state.options.forEach((o, i) => {
        const y = top + i * (height + gap);
        box(24, y, 342, height, o.truth ? '#dfe9d8' : o.id === (state.myVote || selected) ? '#e6e8d3' : o.mine ? '#e3e0d3' : C.white);
        text(String.fromCharCode(65 + i), 35, y + 13, 14, C.red, true);
        wrap(o.text, 57, y + 6, 266, 13, o.mine ? C.muted : C.ink, 17, 2);
        if (reveal) {
          text(`${o.votes}票`, 354, y + 7, 11, C.red, true, 'right');
          const label = o.author || (o.mine ? '本人证词' : '作者待揭晓');
          text(label, 354, y + height - 13, 9, C.muted, false, 'right');
          if (state.revealStep === 2 && o.canLaugh && !state.funnySent && !busy) buttons.push({ x: 24, y, w: 342, h: height, fn: () => action('funny', { optionId: o.id }) });
        } else if (o.mine) text('本人', 354, y + height - 14, 9, C.muted, false, 'right');
        else if (!state.hasVoted && !busy) buttons.push({ x: 24, y, w: 342, h: height, fn: () => { selected = o.id; render(); } });
      });
    }
    function vote(state) {
      title(state, `猜真相 · ${countdown(state)}s`); choices(state, false);
text(state.hasVoted ? '投票已锁定，等好友一起揭晓。' : selected ? '选好了？确认后本轮不能修改。' : '先选一个答案，再确认投票。', 24, 704, 13, C.green, true);
      button(state.hasVoted ? `等待揭晓 (${state.voted}/${state.activeCount || state.players.length}人已投)` : '确认我的选择 →', 24, 739, 342, () => action('vote', { optionId: selected }), state.hasVoted || !selected || !client.connected, false, 44);
    }
    function reveal(state) {
      title(state, ['票数公开', '作者现身', `真相大白 · ${countdown(state)}s`][state.revealStep]); choices(state, true);
      if (state.revealStep === 2) {
        box(24, 687, 342, 35, '#e5e9d9');
        text('为什么是真的？点开看完整解读 →', 36, 698, 12, C.green, true);
        if (!busy) buttons.push({ x: 24, y: 687, w: 342, h: 35, fn: () => { showFact = true; render(); } });
        text(state.funnySent ? '笑脸已送出，不影响胜负。' : '点别人的原创假答案，送一个笑脸。', 24, 728, 11, C.muted);
        button(state.nextReady ? `等大家继续 (${state.nextCount}人)` : `${state.round === state.total ? '查看结算' : '下一轮'} · 本轮 +${state.gains?.[state.self] || 0} 分`, 24, 750, 342, () => action('next'), state.nextReady, false, 35);
      } else wrap('再等一下，真相马上揭晓。', 24, 713, 342, 14, C.muted);
    }
    function result(state) {
      text('本局鉴定完毕', 24, 135, 29, C.ink, true);
      const ranks = state.players.slice().sort((a, b) => b.score - a.score);
      const winners = ranks.filter(p => p.score === ranks[0].score);
      text(winners.length > 1 ? '本局出现并列瞎掰大王！' : `瞎掰大王：${winners[0].name}`, 24, 184, 17, C.red, true);
      memberRows(state, 228, 61, true);
      const me = state.players.find(p => p.id === state.self);
      const laughs = Math.max(...state.players.map(p => p.laughs));
      wrap(laughs ? `全场嘴替：${state.players.filter(p => p.laughs === laughs).map(p => p.name).join('、')}` : '这一局，谁的话最让你上当？', 24, 619, 342, 13, C.green, 19, 2);
      button(state.host === state.self ? '再来一局 →' : '等待房主开新局', 24, 671, 342, () => action('replay'), state.host !== state.self);
      button('复制我的战绩', 24, 731, 342, () => platform.copy(`《瞎掰大王》好友对局：我获得${me.score}分，猜对${me.hits}题，骗到${me.fooled}票，收到${me.laughs}个笑脸！`, () => note('战绩已复制')), false, true, 42);
    }
    function render() {
      if (closed) return;
      const s = client.state;
      const key = s ? `${s.roundId}:${s.phase}` : 'setup';
      if (roundKey !== key) {
        const identity = s ? `${client.base}:${s.code}:${s.self}:${s.roundId}` : '';
        if (draftIdentity && identity !== draftIdentity) platform.save('bluff-draft', null);
        draftIdentity = identity; const stored = platform.load('bluff-draft');
        draft = s?.phase === 'write' && stored?.identity === identity ? stored.text : '';
        selected = null; showFact = false; if (s?.phase !== 'lobby') showModes = false; if (s) showConnection = false; platform.closeInput(); roundKey = key; error = '';
      }
      if (s && (s.phase !== 'write' || s.answered)) platform.save('bluff-draft', null);
      buttons = [];
      const size = platform.size(), canvas = platform.canvas;
      if (canvas.width !== Math.round(size.width * size.dpr)) canvas.width = Math.round(size.width * size.dpr);
      if (canvas.height !== Math.round(size.height * size.dpr)) canvas.height = Math.round(size.height * size.dpr);
      const safeTop = size.safeTop || 0, availableHeight = size.height - safeTop - (size.safeBottom || 0);
      scale = Math.min(size.width / 390, availableHeight / 844); ox = (size.width - 390 * scale) / 2; oy = safeTop + (availableHeight - 844 * scale) / 2;
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0); box(0, 0, size.width, size.height, '#dcded3'); ctx.translate(ox, oy); ctx.scale(scale, scale); box(0, 0, 390, 844, C.paper);
      text('瞎掰鉴定局', 24, 53, 17, C.ink, true); text('FRIENDS / 好友联机', 24, 78, 9, C.muted, true);
      button(s || client.session ? '退出房间' : '返回', 283, 55, 83, () => { if (!s && !client.session) back(); else { confirmLeave = true; render(); } }, false, true, 31);
      box(24, 107, 342, 1, C.line);
      if (!s) { if (client.session) recovery(); else setup(); } else ({ lobby, write, vote, reveal, result }[s.phase])(s);
      box(24, 795, 342, 1, C.line); text(s ? `房间 ${s.code}` : '一本正经，胡说八道。', 24, 813, 10, C.muted);
      text(busy ? '正在处理…' : client.status, 366, 813, 10, client.status === '已连接' ? C.green : C.muted, false, 'right');
      if (s && !client.connected && !busy) {
        box(24, 108, 342, 42, C.ink); text('正在重连 · 草稿会保留', 34, 122, 12, C.white);
        button('立即重试', 270, 113, 86, () => client.poll(), false, true, 31);
      }
      if (showModes && s) {
        buttons = []; box(0, 0, 390, 844, 'rgba(20,30,20,.6)'); box(24, 245, 342, 409);
        text('选一个合适的节奏', 42, 268, 24, C.ink, true);
        const modes = [['quick', '闪电局', '3轮 · 编30秒 / 猜20秒'], ['classic', '经典局', '5轮 · 编60秒 / 猜30秒'], ['relaxed', '慢慢编', '8轮 · 编90秒 / 猜45秒']];
        modes.forEach(([mode, label, hint], i) => {
          const y = 323 + i * 76;
          button(`${s.mode === mode ? '✓ ' : ''}${label}`, 42, y, 306, () => run(async () => { await client.action('settings', { mode }); showModes = false; }), s.host !== s.self || !client.connected, s.mode !== mode, 39);
          text(hint, 48, y + 45, 12, C.muted);
        });
        text(s.host === s.self ? '更换节奏后，所有玩家需要重新准备。' : '节奏由房主调整，所有玩家同步生效。', 42, 565, 12, C.muted);
        button('返回房间', 42, 597, 306, () => { showModes = false; render(); }, false, true, 38);
      }
      if (showConnection) {
        buttons = []; box(0, 0, 390, 844, 'rgba(20,30,20,.6)'); box(24, 264, 342, 335);
        text('连接设置', 42, 288, 24, C.ink, true);
        wrap('从游戏网址进入时会自动连接。跨设备测试，请使用电脑的同 Wi-Fi 地址。', 42, 332, 306, 14, C.muted, 23);
        button(base.length > 30 ? base.slice(0, 28) + '…' : base || '点击填写服务地址', 42, 417, 306, () => input(base, '联机服务地址', 200, value => { base = value; }), false, true, 47);
        button('保存并返回', 42, 503, 306, () => { try { client.configure(base); platform.save('bluff-base', base); showConnection = false; error = ''; } catch (e) { error = e.message; } render(); }, false, false, 44);
        button('取消', 42, 557, 306, () => { base = connectionOriginal; showConnection = false; render(); }, false, true, 27);
      }
      if (showFact && s?.phase === 'reveal') {
        buttons = []; box(0, 0, 390, 844, 'rgba(20,30,20,.6)'); box(24, 233, 342, 399);
        text('原来如此！', 42, 259, 25, C.green, true);
        wrap(s.fact || '', 42, 310, 306, 18, C.ink, 31, 5);
        if (s.source) {
          wrap('出处 · ' + s.source.title, 42, 477, 306, 12, C.muted, 18, 2);
          button('复制出处链接 ↗', 42, 518, 306, () => platform.copy(s.source.url, () => note('出处链接已复制')), false, true, 32);
        }
        button('明白了，继续瞎掰', 42, 565, 306, () => { showFact = false; render(); }, false, true);
      }
      if (error || Date.now() < messageUntil) { box(24, 108, 342, 42, error ? C.red : C.ink); wrap(error || message, 33, 114, 324, 12, C.white, 16, 2); }
      if (confirmLeave) {
        buttons = []; box(0, 0, 390, 844, 'rgba(20,30,20,.6)'); box(24, 300, 342, 204); text('确定退出这个房间？', 42, 324, 21, C.ink, true);
        wrap(client.connected ? '退出后本局不能重新加入。暂时切到后台可以保留身份并自动恢复。' : '网络未恢复，将只清除本机房间身份。原房间的离线席位可由房主移除。', 42, 366, 304, 14, C.muted, 22);
        button('继续玩', 42, 438, 136, () => { confirmLeave = false; render(); }, false, true);
        button(client.connected ? '退出房间' : '仅退出本机', 195, 438, 151, () => run(async () => { if (client.connected) await client.action('leave'); else client.forget(); platform.save('bluff-draft', null); confirmLeave = false; back(); }));
      }
    }
    platform.onTap((x, y) => { x = (x - ox) / scale; y = (y - oy) / scale; const b = buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); if (b) b.fn(); });
    platform.onResize(render);
    const interval = setInterval(() => { if (!client.paused && !client.background && (client.state?.deadline || messageUntil)) { if (messageUntil && Date.now() >= messageUntil) messageUntil = 0; render(); } }, 500); render();
    if (saved && (!invitedCode || invitedCode === saved.code)) run(() => client.resume(saved));
    return { client, render, destroy() { closed = true; clearInterval(interval); client.close(); platform.closeInput(); } };
  }
  if (typeof module !== 'undefined') module.exports = startRoomUI; else root.startRoomUI = startRoomUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
