  (function () {
    'use strict';

    // ═══════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════
    const DEFAULT_ROWS = 4;
    const DEFAULT_COLS = 4;
    const DEFAULT_IMG = 'img/demo.jpg';
    const MIN_GRID = 4;
    const MAX_GRID = 10;

    // img 文件夹下的可用图片列表
    const IMG_LIST = [
      'img/demo.jpg',
      'img/demo1.jpg',
      'img/demo2.png',
      'img/demo3.png',
      'img/demo4.png',
      'img/demo5.png',
      'img/demo6.png',
    ];

    // 按横竖版分类的图片列表
    let portraitImages = [];   // 竖版（高 > 宽），手机端使用
    let landscapeImages = [];  // 横版（宽 >= 高），桌面端使用
    let activeImageList = [];  // 当前设备对应的图片列表

    function isMobileDevice() {
      return window.innerWidth < 768;
    }

    // 预加载所有图片并分类横竖版
    function buildImageLists(callback) {
      var loaded = 0;
      var total = IMG_LIST.length;
      portraitImages = [];
      landscapeImages = [];

      IMG_LIST.forEach(function (src) {
        var probe = new Image();
        probe.onload = function () {
          if (probe.height > probe.width) {
            portraitImages.push(src);
          } else {
            landscapeImages.push(src);
          }
          loaded++;
          if (loaded >= total) finish();
        };
        probe.onerror = function () {
          // 加载失败默认归为横版
          landscapeImages.push(src);
          loaded++;
          if (loaded >= total) finish();
        };
        probe.src = src;
      });

      function finish() {
        updateActiveImageList();
        if (callback) callback();
      }
    }

    function updateActiveImageList() {
      var list = isMobileDevice() ? portraitImages : landscapeImages;
      // 如果当前设备对应的列表为空，回退到全部图片
      if (list.length === 0) list = IMG_LIST;
      activeImageList = list;
    }

    function getActiveImageList() {
      updateActiveImageList();
      return activeImageList;
    }

    // ═══════════════════════════════════════
    //  DOM 引用
    // ═══════════════════════════════════════
    const canvas = document.getElementById('puzzle-canvas');
    const ctx = canvas.getContext('2d');
    const gridInput = document.getElementById('grid-input');
    const btnPreview = document.getElementById('btn-preview');
    const completeOverlay = document.getElementById('complete-overlay');
    const btnSound = document.getElementById('btn-sound');
    const volumePopup = document.getElementById('volume-popup');
    const sfxVolumeSlider = document.getElementById('sfx-volume');
    const bgmVolumeSlider = document.getElementById('bgm-volume');
    const confettiContainer = document.getElementById('confetti-container');
    const completionStats = document.getElementById('completion-stats');
    const mobileHint = document.getElementById('mobile-hint');
    const statTimer = document.getElementById('stat-timer');
    const statMoves = document.getElementById('stat-moves');
    const btnPause = document.getElementById('btn-pause');

    // ═══════════════════════════════════════
    //  游戏状态
    // ═══════════════════════════════════════
    let rows = DEFAULT_ROWS;
    let cols = DEFAULT_COLS;
    let total = rows * cols;

    let image = null;
    let currentImageSrc = DEFAULT_IMG;
    let currentImageIndex = 0; // IMG_LIST 中的当前索引
    let previewMode = false;
    let gameComplete = false;
    let moveCount = 0;
    let startTime = 0;
    let paused = false;
    let elapsedSeconds = 0;
    let timerInterval = null;

    // 画布 / 网格布局
    let gridX = 0, gridY = 0;
    let gridW = 0, gridH = 0;
    let cellW = 0, cellH = 0;

    // 切片数据
    let pieces = [];
    let grid = [];
    let parent = [];

    // 拖拽状态
    let isDragging = false;
    let dragPieceId = null;
    let dragGroupIds = [];
    let dragStartX = 0, dragStartY = 0;
    let dragAnchorCellX = 0, dragAnchorCellY = 0;
    let dragDx = 0, dragDy = 0;

    // 高 DPI 适配：逻辑尺寸（CSS 像素），canvas 内部分辨率为逻辑尺寸 × devicePixelRatio
    let canvasLogicalW = 0;
    let canvasLogicalH = 0;
    // 移动端边框缩放因子
    let styleScale = 1.0;

    // ═══════════════════════════════════════
    //  音效系统 (MP3 文件播放)
    //  将 MP3 文件放入 puzzle/sounds/ 目录即可自动加载
    // ═══════════════════════════════════════

    // 音效文件路径（替换这些文件即可更换音效，支持 .wav / .mp3 / .ogg）
    var SOUND_FILES = {
      pickup:   'sounds/pickup.wav',
      drop:     'sounds/drop.wav',
      // snap:     'sounds/snap.wav',
      complete: 'sounds/complete.wav',
      shuffle:  'sounds/shuffle.wav',
      button:   'sounds/button.wav',
      bgm:      'sounds/bgm.wav',
    };

    var soundEnabled = true;
    var sfxVolume = 0.6;
    var bgmVolume = 0.3;
    var bgmAudio = null;

    // 播放音效（短音效，每次创建新实例以支持重叠播放）
    function playSfx(name) {
      if (!soundEnabled || sfxVolume <= 0) return;
      try {
        var audio = new Audio(SOUND_FILES[name]);
        audio.volume = sfxVolume;
        audio.play().catch(function () { /* 文件不存在时静默忽略 */ });
      } catch (_) { /* 静默忽略 */ }
    }

    // ── 各音效 ──
    function playPickupSound()   { playSfx('pickup'); }
    function playDropSound()     { playSfx('drop'); }
    function playSnapSound()     { playSfx('snap'); }
    function playCompleteSound() { playSfx('complete'); }
    function playShuffleSound()  { playSfx('shuffle'); }
    function playButtonSound()   { playSfx('button'); }

    // ── 背景音乐（循环播放） ──
    function startBgm() {
      if (bgmAudio || !soundEnabled || bgmVolume <= 0) return;
      try {
        bgmAudio = new Audio(SOUND_FILES.bgm);
        bgmAudio.loop = true;
        bgmAudio.volume = bgmVolume;
        bgmAudio.play().catch(function () { bgmAudio = null; });
      } catch (_) { bgmAudio = null; }
    }

    function stopBgm() {
      if (bgmAudio) {
        bgmAudio.pause();
        bgmAudio.currentTime = 0;
        bgmAudio = null;
      }
    }

    function updateSoundState() {
      if (soundEnabled) {
        if (bgmAudio) {
          bgmAudio.volume = bgmVolume;
          if (bgmAudio.paused) bgmAudio.play().catch(function () {});
        }
        btnSound.textContent = (bgmAudio && !bgmAudio.paused) ? '🎵' : '🔊';
        btnSound.classList.remove('muted');
      } else {
        if (bgmAudio) bgmAudio.pause();
        btnSound.textContent = '🔇';
        btnSound.classList.add('muted');
      }
    }

    function toggleSound() {
      soundEnabled = !soundEnabled;
      if (soundEnabled) {
        sfxVolume = parseInt(sfxVolumeSlider.value) / 100;
        bgmVolume = parseInt(bgmVolumeSlider.value) / 100;
        if (!bgmAudio && bgmVolume > 0) {
          startBgm();
        } else if (bgmAudio) {
          bgmAudio.volume = bgmVolume;
          if (bgmAudio.paused) bgmAudio.play().catch(function () {});
        }
      }
      updateSoundState();
      playButtonSound();
    }

    sfxVolumeSlider.addEventListener('input', function () {
      sfxVolume = parseInt(this.value) / 100;
    });

    bgmVolumeSlider.addEventListener('input', function () {
      bgmVolume = parseInt(this.value) / 100;
      if (bgmAudio) {
        bgmAudio.volume = bgmVolume;
      }
      if (bgmVolume > 0 && !bgmAudio && soundEnabled) {
        startBgm();
      } else if (bgmVolume === 0 && bgmAudio) {
        stopBgm();
      }
    });

    btnSound.addEventListener('click', function (e) {
      e.stopPropagation();
      if (volumePopup.classList.contains('show')) {
        volumePopup.classList.remove('show');
      } else {
        toggleSound();
      }
    });

    // 长按打开音量设置
    var soundLongPressTimer;
    btnSound.addEventListener('pointerdown', function (e) {
      soundLongPressTimer = setTimeout(function () {
        volumePopup.classList.toggle('show');
        playButtonSound();
      }, 500);
    });
    btnSound.addEventListener('pointerup', function () {
      clearTimeout(soundLongPressTimer);
    });
    btnSound.addEventListener('pointerleave', function () {
      clearTimeout(soundLongPressTimer);
    });

    // 点击其他地方关闭音量弹窗
    document.addEventListener('click', function (e) {
      if (!volumePopup.contains(e.target) && e.target !== btnSound) {
        volumePopup.classList.remove('show');
      }
    });

    // ── 触觉反馈 ──
    function haptic(style) {
      try {
        if (navigator.vibrate) {
          switch (style) {
            case 'pickup': navigator.vibrate(10); break;
            case 'drop':   navigator.vibrate(15); break;
            case 'snap':   navigator.vibrate([10, 20, 15]); break;
            case 'complete': navigator.vibrate([30, 50, 30, 50, 60]); break;
            default: break;
          }
        }
      } catch (_) { /* ok */ }
    }

    // ═══════════════════════════════════════
    //  庆祝彩带
    // ═══════════════════════════════════════
    function spawnConfetti() {
      var colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#cc5de8','#20c997','#ff6eb4'];
      var fragment = document.createDocumentFragment();
      for (var i = 0; i < 80; i++) {
        var piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.top = -(Math.random() * 20) + 'px';
        piece.style.width = (6 + Math.random() * 10) + 'px';
        piece.style.height = (6 + Math.random() * 10) + 'px';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (2 + Math.random() * 3) + 's';
        piece.style.animationDelay = Math.random() * 0.8 + 's';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        fragment.appendChild(piece);
      }
      confettiContainer.appendChild(fragment);
      // 清理
      setTimeout(function() {
        confettiContainer.innerHTML = '';
      }, 4000);
    }

    // ═══════════════════════════════════════
    //  图片加载
    // ═══════════════════════════════════════
    function loadImage(src) {
      var img = new Image();
      img.onload = function () {
        image = img;
        currentImageSrc = src;
        resetGameState();
        layout();
        initGame();
        render();
      };
      img.onerror = function () {
        console.error('图片加载失败: ' + src);
        // 生成渐变占位图
        var off = document.createElement('canvas');
        off.width = 800; off.height = 600;
        var octx = off.getContext('2d');
        var grad = octx.createLinearGradient(0, 0, 800, 600);
        grad.addColorStop(0, '#e94560');
        grad.addColorStop(0.5, '#f0c040');
        grad.addColorStop(1, '#0f3460');
        octx.fillStyle = grad;
        octx.fillRect(0, 0, 800, 600);
        for (var i = 0; i < 12; i++) {
          octx.beginPath();
          octx.arc(80 + Math.random() * 640, 60 + Math.random() * 480,
                   20 + Math.random() * 60, 0, Math.PI * 2);
          octx.fillStyle = 'hsla(' + Math.floor(Math.random() * 360) + ',55%,60%,0.25)';
          octx.fill();
        }
        var fallback = new Image();
        fallback.onload = function () {
          image = fallback;
          currentImageSrc = src;
          resetGameState();
          layout();
          initGame();
          render();
        };
        fallback.src = off.toDataURL();
      };
      img.src = src;
    }

    function resetGameState() {
      gameComplete = false;
      previewMode = false;
      paused = false;
      moveCount = 0;
      startTime = Date.now();
      completeOverlay.classList.remove('show');
      btnPreview.textContent = '👁 查看原图';
      btnPreview.classList.remove('active');
      confettiContainer.innerHTML = '';
      if (btnPause) {
        btnPause.classList.remove('paused');
        btnPause.textContent = '⏯';
      }
      startTimer();
      updateStatsDisplay();
    }

    // ═══════════════════════════════════════
    //  Canvas 尺寸 & 布局
    // ═══════════════════════════════════════
    function resizeCanvas() {
      var dpr = window.devicePixelRatio || 1;
      var gameArea = document.querySelector('.game-area');
      var style = window.getComputedStyle(gameArea);
      var padH = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      var padW = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

      var availW = gameArea.clientWidth - padW;
      var availH = gameArea.clientHeight - padH;

      // 确保最小尺寸
      availW = Math.max(availW, 200);
      availH = Math.max(availH, 150);

      var logicalW = Math.floor(availW);
      var logicalH = Math.floor(availH);

      var neededW = Math.floor(logicalW * dpr);
      var neededH = Math.floor(logicalH * dpr);

      if (canvas.width !== neededW || canvas.height !== neededH) {
        canvas.width = neededW;
        canvas.height = neededH;
        canvas.style.width = logicalW + 'px';
        canvas.style.height = logicalH + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      canvasLogicalW = logicalW;
      canvasLogicalH = logicalH;
    }

    function layout() {
      resizeCanvas();
      // 移动端使用更小的边框缩放因子
      styleScale = window.innerWidth < 600 ? 0.6 : 1.0;
      var cw = canvasLogicalW;
      var ch = canvasLogicalH;
      var margin = Math.max(16, Math.min(cw, ch) * 0.05);
      var availW = cw - margin * 2;
      var availH = ch - margin * 2;
      var imgAspect = image.width / image.height;

      var gw, gh;
      if (imgAspect > availW / availH) {
        gw = availW;
        gh = gw / imgAspect;
      } else {
        gh = availH;
        gw = gh * imgAspect;
      }

      gridW = gw;
      gridH = gh;
      gridX = (cw - gw) / 2;
      gridY = (ch - gh) / 2;
      cellW = gw / cols;
      cellH = gh / rows;
    }

    // ═══════════════════════════════════════
    //  游戏初始化 / 洗牌
    // ═══════════════════════════════════════
    function initGame() {
      total = rows * cols;
      pieces = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var id = r * cols + c;
          pieces.push({ id: id, correctRow: r, correctCol: c });
        }
      }

      grid = [];
      for (var r = 0; r < rows; r++) {
        grid[r] = [];
        for (var c = 0; c < cols; c++) {
          grid[r][c] = r * cols + c;
        }
      }

      shuffleGrid();
      var safety = 0;
      while (isComplete() && safety < 100) {
        shuffleGrid();
        safety++;
      }

      rebuildAllConnections();
      moveCount = 0;
      paused = false;
      startTime = Date.now();
      gameComplete = false;
      completeOverlay.classList.remove('show');
      if (btnPause) {
        btnPause.classList.remove('paused');
        btnPause.textContent = '⏯';
      }
      startTimer();
      updateStatsDisplay();
    }

    function shuffleGrid() {
      var flat = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          flat.push(grid[r][c]);
        }
      }
      for (var i = flat.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = flat[i]; flat[i] = flat[j]; flat[j] = tmp;
      }
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          grid[r][c] = flat[r * cols + c];
        }
      }
    }

    function isComplete() {
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pid = grid[r][c];
          if (pid < 0) return false;
          var p = pieces[pid];
          if (p.correctRow !== r || p.correctCol !== c) return false;
        }
      }
      return true;
    }

    // ═══════════════════════════════════════
    //  连接判断（并查集）
    // ═══════════════════════════════════════
    function ufInit() {
      parent = [];
      for (var i = 0; i < total; i++) parent[i] = i;
    }

    function ufFind(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }

    function ufUnion(a, b) {
      var ra = ufFind(a);
      var rb = ufFind(b);
      if (ra !== rb) parent[rb] = ra;
    }

    function canConnect(pidA, pidB) {
      var posA = null, posB = null;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (grid[r][c] === pidA) posA = { r: r, c: c };
          if (grid[r][c] === pidB) posB = { r: r, c: c };
        }
      }
      if (!posA || !posB) return false;

      var dr = posB.r - posA.r;
      var dc = posB.c - posA.c;
      if (Math.abs(dr) + Math.abs(dc) !== 1) return false;

      var pA = pieces[pidA];
      var pB = pieces[pidB];
      return (pB.correctRow - pA.correctRow === dr) &&
             (pB.correctCol - pA.correctCol === dc);
    }

    function rebuildAllConnections() {
      ufInit();
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pid = grid[r][c];
          if (pid < 0) continue;
          if (c + 1 < cols) {
            var pidR = grid[r][c + 1];
            if (pidR >= 0 && canConnect(pid, pidR)) ufUnion(pid, pidR);
          }
          if (r + 1 < rows) {
            var pidD = grid[r + 1][c];
            if (pidD >= 0 && canConnect(pid, pidD)) ufUnion(pid, pidD);
          }
        }
      }
    }

    function getGroup(pid) {
      var root = ufFind(pid);
      var group = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var id = grid[r][c];
          if (id >= 0 && ufFind(id) === root) group.push(id);
        }
      }
      return group;
    }

    // ═══════════════════════════════════════
    //  移动 / 交换逻辑
    // ═══════════════════════════════════════
    function findGridPos(pid) {
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (grid[r][c] === pid) return { r: r, c: c };
        }
      }
      return null;
    }

    function getGroupCells(anchorId) {
      var anchorPos = findGridPos(anchorId);
      if (!anchorPos) return [];
      var groupIds = getGroup(anchorId);
      return groupIds.map(function (pid) {
        var pos = findGridPos(pid);
        return {
          pid: pid,
          r: pos.r,
          c: pos.c,
          dr: pos.r - anchorPos.r,
          dc: pos.c - anchorPos.c,
        };
      });
    }

    function moveGroup(anchorId, targetRow, targetCol) {
      var anchorPos = findGridPos(anchorId);
      if (!anchorPos) return false;

      var dRow = targetRow - anchorPos.r;
      var dCol = targetCol - anchorPos.c;
      if (dRow === 0 && dCol === 0) return false;

      var groupCells = getGroupCells(anchorId);
      var groupIdSet = new Set();
      for (var i = 0; i < groupCells.length; i++) {
        groupIdSet.add(groupCells[i].pid);
      }

      var newCells = groupCells.map(function (g) {
        return { pid: g.pid, r: g.r + dRow, c: g.c + dCol };
      });

      // 边界检查
      for (var i = 0; i < newCells.length; i++) {
        var nc = newCells[i];
        if (nc.r < 0 || nc.r >= rows || nc.c < 0 || nc.c >= cols) return false;
      }

      // 收集被挤出的 piece
      var displaced = [];
      var seenDisplaced = {};
      for (var i = 0; i < newCells.length; i++) {
        var nc = newCells[i];
        var existingPid = grid[nc.r][nc.c];
        if (existingPid >= 0 && !groupIdSet.has(existingPid)) {
          var key = existingPid + '@' + nc.r + ',' + nc.c;
          if (!seenDisplaced[key]) {
            seenDisplaced[key] = true;
            displaced.push({ pid: existingPid, fromR: nc.r, fromC: nc.c });
          }
        }
      }

      // 收集空位
      var freeSlots = [];
      for (var i = 0; i < groupCells.length; i++) {
        var gc = groupCells[i];
        var isOverlap = false;
        for (var j = 0; j < newCells.length; j++) {
          if (newCells[j].r === gc.r && newCells[j].c === gc.c) {
            isOverlap = true;
            break;
          }
        }
        if (!isOverlap) {
          freeSlots.push({ r: gc.r, c: gc.c });
        }
      }

      // 清除旧位置
      for (var i = 0; i < groupCells.length; i++) {
        var gc = groupCells[i];
        var isOverlap = false;
        for (var j = 0; j < newCells.length; j++) {
          if (newCells[j].r === gc.r && newCells[j].c === gc.c) {
            isOverlap = true;
            break;
          }
        }
        if (!isOverlap) {
          grid[gc.r][gc.c] = -1;
        }
      }

      // 放置 displaced 到 freeSlots
      var limit = Math.min(displaced.length, freeSlots.length);
      for (var i = 0; i < limit; i++) {
        grid[freeSlots[i].r][freeSlots[i].c] = displaced[i].pid;
      }
      for (var i = displaced.length; i < freeSlots.length; i++) {
        grid[freeSlots[i].r][freeSlots[i].c] = -1;
      }

      // 放置组到新位置
      for (var i = 0; i < newCells.length; i++) {
        grid[newCells[i].r][newCells[i].c] = newCells[i].pid;
      }

      // 清理残余 -1
      var dispIdx = limit;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (grid[r][c] === -1) {
            if (dispIdx < displaced.length) {
              grid[r][c] = displaced[dispIdx].pid;
              dispIdx++;
            } else {
              grid[r][c] = displaced[0] ? displaced[0].pid : 0;
            }
          }
        }
      }

      rebuildAllConnections();
      return true;
    }

    // ═══════════════════════════════════════
    //  渲染
    // ═══════════════════════════════════════
    function cellCanvasX(c) { return gridX + c * cellW; }
    function cellCanvasY(r) { return gridY + r * cellH; }

    function roundRectPath(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }

    function buildCellSet(groupIds) {
      var set = new Set();
      for (var i = 0; i < groupIds.length; i++) {
        var pos = findGridPos(groupIds[i]);
        if (pos) set.add(pos.r + ',' + pos.c);
      }
      return set;
    }

    function render() {
      var W = canvasLogicalW;
      var H = canvasLogicalH;

      ctx.fillStyle = '#f2f2f7';
      ctx.fillRect(0, 0, W, H);

      if (previewMode) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, W, H);

        ctx.drawImage(image, gridX, gridY, gridW, gridH);

        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        for (var r = 1; r < rows; r++) {
          var y = cellCanvasY(r);
          ctx.beginPath(); ctx.moveTo(gridX, y); ctx.lineTo(gridX + gridW, y); ctx.stroke();
        }
        for (var c = 1; c < cols; c++) {
          var x = cellCanvasX(c);
          ctx.beginPath(); ctx.moveTo(x, gridY); ctx.lineTo(x, gridY + gridH); ctx.stroke();
        }

        // 底部提示条
        var tipH = 36;
        var tipY = H - tipH;
        ctx.fillStyle = 'rgba(0,0,0,0.70)';
        ctx.fillRect(0, tipY, W, tipH);

        ctx.fillStyle = '#fff';
        ctx.font = '600 13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👁 原图模式 · 点击任意位置关闭', W / 2, tipY + tipH / 2);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'start';
        return;
      }

      // 收集组信息
      var groupRoot = {};
      var groupSize = {};
      var drawnRoots = {};

      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pid = grid[r][c];
          if (pid < 0) continue;
          var rootP = ufFind(pid);
          groupSize[rootP] = (groupSize[rootP] || 0) + 1;
        }
      }
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pid = grid[r][c];
          if (pid < 0) continue;
          var rootP = ufFind(pid);
          groupRoot[pid] = (groupSize[rootP] >= 2) ? rootP : -1;
        }
      }

      var dragSet = {};
      if (isDragging && dragGroupIds.length > 0) {
        for (var i = 0; i < dragGroupIds.length; i++) {
          dragSet[dragGroupIds[i]] = true;
        }
      }

      // 第一遍：非拖拽 piece
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pid = grid[r][c];
          if (pid < 0) continue;
          if (dragSet[pid]) continue;
          var inGrp = groupRoot[pid] !== -1;
          drawPieceAtCell(pid, r, c, false, inGrp);
        }
      }

      // 第二遍：非拖拽组轮廓
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var pid = grid[r][c];
          if (pid < 0) continue;
          if (dragSet[pid]) continue;
          var rootP = groupRoot[pid];
          if (rootP === -1) continue;
          if (drawnRoots[rootP]) continue;
          drawnRoots[rootP] = true;
          drawGroupContour(getGroup(pid), false);
        }
      }

      // 第三遍：拖拽中的 piece & 轮廓
      if (isDragging && dragGroupIds.length > 0) {
        var dragInGroup = dragGroupIds.length >= 2;
        for (var i = 0; i < dragGroupIds.length; i++) {
          var pid2 = dragGroupIds[i];
          var pos = findGridPos(pid2);
          if (pos) drawPieceAtCell(pid2, pos.r, pos.c, true, dragInGroup);
        }
        drawGroupContour(dragGroupIds, true);
      }

      // 暂停遮罩
      if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.font = '700 24px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⏸ 已暂停', W / 2, H / 2 - 8);
        ctx.font = '500 13px -apple-system, sans-serif';
        ctx.fillText('点击画面继续', W / 2, H / 2 + 24);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }

      // 完成提示
      if (isComplete() && !isDragging) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(0, H / 2 - 34, W, 68);
        ctx.fillStyle = '#2d8c3c';
        ctx.font = '700 22px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎉 恭喜完成！', W / 2, H / 2);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    }

    function drawPieceAtCell(pid, row, col, isDraggingPiece, inGroup) {
      var p = pieces[pid];
      var x = cellCanvasX(col);
      var y = cellCanvasY(row);

      if (isDraggingPiece) {
        x += dragDx;
        y += dragDy;
      }

      var sx = p.correctCol * (image.width / cols);
      var sy = p.correctRow * (image.height / rows);
      var sw = image.width / cols;
      var sh = image.height / rows;

      if (inGroup) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        ctx.drawImage(image, sx, sy, sw, sh, x, y, cellW, cellH);
        ctx.restore();
      } else {
        var gap = Math.max(0.5, 2 * styleScale);
        var cornerR = Math.max(1, 5 * styleScale);
        var lineW = Math.max(0.5, 2.5 * styleScale);
        ctx.save();
        roundRectPath(x + gap, y + gap, cellW - gap * 2, cellH - gap * 2, cornerR);
        ctx.clip();
        ctx.drawImage(image, sx, sy, sw, sh, x, y, cellW, cellH);
        ctx.restore();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = lineW;
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = Math.max(2, 4 * styleScale);
        ctx.shadowOffsetY = 1;
        roundRectPath(x + gap, y + gap, cellW - gap * 2, cellH - gap * 2, cornerR);
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      }
    }

    function drawGroupContour(groupIds, isDraggingGroup) {
      var cellSet = buildCellSet(groupIds);
      if (cellSet.size === 0) return;

      var offsetX = isDraggingGroup ? dragDx : 0;
      var offsetY = isDraggingGroup ? dragDy : 0;
      var GAP = Math.max(0.5, 1.5 * styleScale);
      var lineW = Math.max(0.5, (isDraggingGroup ? 3.5 : 2.5) * styleScale);

      ctx.save();
      ctx.strokeStyle = '#5b9ef0';
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(91,158,240,0.3)';
      ctx.shadowBlur = 10;

      for (var r = 0; r <= rows; r++) {
        var cStart = -1;
        for (var c = 0; c < cols; c++) {
          var hasTop = cellSet.has(r + ',' + c) && !cellSet.has((r - 1) + ',' + c);
          if (hasTop && cStart === -1) { cStart = c; }
          if (!hasTop && cStart !== -1) {
            drawHEdge(r, cStart, c, offsetX, offsetY, GAP);
            cStart = -1;
          }
        }
        if (cStart !== -1) drawHEdge(r, cStart, cols, offsetX, offsetY, GAP);
      }

      for (var r = 0; r < rows; r++) {
        var cStart = -1;
        for (var c = 0; c < cols; c++) {
          var hasBot = cellSet.has(r + ',' + c) && !cellSet.has((r + 1) + ',' + c);
          if (hasBot && cStart === -1) { cStart = c; }
          if (!hasBot && cStart !== -1) {
            drawHEdge(r + 1, cStart, c, offsetX, offsetY, GAP);
            cStart = -1;
          }
        }
        if (cStart !== -1) drawHEdge(r + 1, cStart, cols, offsetX, offsetY, GAP);
      }

      for (var c = 0; c <= cols; c++) {
        var rStart = -1;
        for (var r2 = 0; r2 < rows; r2++) {
          var hasLeft = cellSet.has(r2 + ',' + c) && !cellSet.has(r2 + ',' + (c - 1));
          if (hasLeft && rStart === -1) { rStart = r2; }
          if (!hasLeft && rStart !== -1) {
            drawVEdge(c, rStart, r2, offsetX, offsetY, GAP);
            rStart = -1;
          }
        }
        if (rStart !== -1) drawVEdge(c, rStart, rows, offsetX, offsetY, GAP);
      }

      for (var c = 0; c < cols; c++) {
        var rStart = -1;
        for (var r2 = 0; r2 < rows; r2++) {
          var hasRight = cellSet.has(r2 + ',' + c) && !cellSet.has(r2 + ',' + (c + 1));
          if (hasRight && rStart === -1) { rStart = r2; }
          if (!hasRight && rStart !== -1) {
            drawVEdge(c + 1, rStart, r2, offsetX, offsetY, GAP);
            rStart = -1;
          }
        }
        if (rStart !== -1) drawVEdge(c + 1, rStart, rows, offsetX, offsetY, GAP);
      }

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    function drawHEdge(row, cStart, cEnd, offsetX, offsetY, gap) {
      var x1 = cellCanvasX(cStart) + gap + offsetX;
      var x2 = cellCanvasX(cEnd) - gap + offsetX;
      var y = cellCanvasY(row) + offsetY;
      if (x2 <= x1) return;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    }

    function drawVEdge(col, rStart, rEnd, offsetX, offsetY, gap) {
      var y1 = cellCanvasY(rStart) + gap + offsetY;
      var y2 = cellCanvasY(rEnd) - gap + offsetY;
      var x = cellCanvasX(col) + offsetX;
      if (y2 <= y1) return;
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.stroke();
    }

    // ═══════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════
    function canvasPos(e) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvasLogicalW / rect.width),
        y: (e.clientY - rect.top) * (canvasLogicalH / rect.height),
      };
    }

    function cellAt(cx, cy) {
      var col = Math.floor((cx - gridX) / cellW);
      var row = Math.floor((cy - gridY) / cellH);
      if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
      return { row: row, col: col };
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (!image) return;

      if (paused) {
        togglePause();
        return;
      }

      if (previewMode) {
        togglePreview();
        return;
      }

      var pos = canvasPos(e);
      var cell = cellAt(pos.x, pos.y);
      if (!cell) return;
      var pid = grid[cell.row][cell.col];
      if (pid < 0) return;

      isDragging = true;
      dragPieceId = pid;
      dragGroupIds = getGroup(pid);
      dragStartX = pos.x;
      dragStartY = pos.y;
      dragAnchorCellX = cellCanvasX(cell.col);
      dragAnchorCellY = cellCanvasY(cell.row);
      dragDx = 0;
      dragDy = 0;

      canvas.setPointerCapture(e.pointerId);
      playPickupSound();
      haptic('pickup');
      render();
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!isDragging) return;
      var pos = canvasPos(e);
      dragDx = pos.x - dragStartX;
      dragDy = pos.y - dragStartY;
      render();
      e.preventDefault();
    });

    canvas.addEventListener('pointerup', function (e) {
      if (!isDragging) return;
      var pos = canvasPos(e);

      var anchorX = dragAnchorCellX + dragDx + cellW / 2;
      var anchorY = dragAnchorCellY + dragDy + cellH / 2;
      var targetCell = cellAt(anchorX, anchorY);
      var oldGroupSize = dragGroupIds.length;
      var didMove = false;

      if (targetCell) {
        didMove = moveGroup(dragPieceId, targetCell.row, targetCell.col);
        if (didMove) {
          moveCount++;
          updateStatsDisplay();
          var newGroup = getGroup(dragPieceId);
          if (newGroup.length > oldGroupSize) {
            playSnapSound();
            haptic('snap');
          } else {
            playDropSound();
            haptic('drop');
          }
        }
      }

      if (!didMove) {
        playDropSound();
        haptic('drop');
      }

      isDragging = false;
      dragPieceId = null;
      dragGroupIds = [];
      dragDx = 0;
      dragDy = 0;

      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }

      if (isComplete() && !gameComplete) {
        gameComplete = true;
        stopTimer();
        playCompleteSound();
        haptic('complete');
        spawnConfetti();
        render();

        var timeStr = formatTime(elapsedSeconds);
        completionStats.textContent = '⏱ ' + timeStr + '  |  🖐 ' + moveCount + '步';

        setTimeout(function () {
          completeOverlay.classList.add('show');
        }, 600);
      } else {
        render();
      }
    });

    canvas.addEventListener('pointercancel', function (e) {
      if (!isDragging) return;
      isDragging = false;
      dragPieceId = null;
      dragGroupIds = [];
      dragDx = 0;
      dragDy = 0;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }
      render();
    });

    // 阻止移动端默认行为
    canvas.addEventListener('touchstart', function (e) {
      if (e.target === canvas) e.preventDefault();
    }, { passive: false });

    // ═══════════════════════════════════════
    //  计时 & 步数显示
    // ═══════════════════════════════════════

    function formatTime(sec) {
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function updateStatsDisplay() {
      if (statTimer) statTimer.textContent = '⏱ ' + formatTime(elapsedSeconds);
      if (statMoves) statMoves.textContent = '🖐 ' + moveCount + '步';
    }

    function startTimer() {
      stopTimer();
      elapsedSeconds = 0;
      updateStatsDisplay();
      timerInterval = setInterval(function () {
        if (!paused) {
          elapsedSeconds++;
          updateStatsDisplay();
        }
      }, 1000);
    }

    function stopTimer() {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }

    function togglePause() {
      if (gameComplete || !image) return;
      paused = !paused;
      if (paused) {
        btnPause.classList.add('paused');
        btnPause.textContent = '▶';
      } else {
        btnPause.classList.remove('paused');
        btnPause.textContent = '⏯';
      }
      playButtonSound();
      render();
    }

    btnPause.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePause();
    });

    // ═══════════════════════════════════════
    //  UI 控制
    // ═══════════════════════════════════════

    // ── 网格选择解析 ──
    function parseGridInput(value) {
      var n = parseInt(value, 10);
      if (isNaN(n) || n < 4 || n > 10) return null;
      return { rows: n, cols: n };
    }

    function setGridSize(newRows, newCols) {
      if (rows === newRows && cols === newCols) return;
      rows = newRows;
      cols = newCols;
      total = rows * cols;
      gridInput.value = rows;

      if (image) {
        playShuffleSound();
        resetGameState();
        layout();
        initGame();
        render();
      }
    }

    function updateGridInputUI() {
      gridInput.value = rows;
    }

    gridInput.addEventListener('change', function () {
      var parsed = parseGridInput(this.value);
      if (parsed) {
        playButtonSound();
        setGridSize(parsed.rows, parsed.cols);
      } else {
        this.value = rows;
      }
    });

    // ── 预览原图 ──
    function togglePreview() {
      if (!image || gameComplete) return;
      previewMode = !previewMode;
      if (previewMode) {
        btnPreview.textContent = '🙈 隐藏';
        btnPreview.classList.add('active');
        if (mobileHint) mobileHint.textContent = '👆 点击画面任意位置关闭原图';
      } else {
        btnPreview.textContent = '👁 查看原图';
        btnPreview.classList.remove('active');
        if (mobileHint) mobileHint.textContent = '👆 点击「👁 查看原图」查看完整图片，点击「📷 换图」更换图片';
      }
      playButtonSound();
      render();
    }

    btnPreview.addEventListener('click', togglePreview);

    // ── 换图片（从 img 文件夹循环切换，手机端仅竖版，桌面端仅横版） ──
    document.getElementById('btn-upload').addEventListener('click', function () {
      playButtonSound();
      var list = getActiveImageList();
      if (list.length === 0) return;
      currentImageIndex = (currentImageIndex + 1) % list.length;
      loadImage(list[currentImageIndex]);
      playShuffleSound();
    });

    // ── 重新打乱 ──
    function restartGame() {
      if (!image) return;
      resetGameState();
      shuffleGrid();
      var safety = 0;
      while (isComplete() && safety < 100) { shuffleGrid(); safety++; }
      rebuildAllConnections();
      playShuffleSound();
      render();
    }

    document.getElementById('btn-restart').addEventListener('click', function () {
      playButtonSound();
      restartGame();
    });

    // ── 完成弹窗按钮 ──
    document.getElementById('btn-replay').addEventListener('click', function () {
      playButtonSound();
      restartGame();
    });

    document.getElementById('btn-replay-harder').addEventListener('click', function () {
      playButtonSound();
      setGridSize(Math.min(rows + 1, MAX_GRID), Math.min(cols + 1, MAX_GRID));
      restartGame();
    });

    completeOverlay.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) {
        playButtonSound();
        restartGame();
      }
    });

    // ═══════════════════════════════════════
    //  窗口大小变化
    // ═══════════════════════════════════════
    var resizeTimeout;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function () {
        if (!image) return;
        layout();
        render();
      }, 200);
    });

    // 监听屏幕旋转
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        if (!image) return;
        layout();
        render();
      }, 300);
    });

    // ═══════════════════════════════════════
    //  键盘快捷键
    // ═══════════════════════════════════════
    window.addEventListener('keydown', function (e) {
      if (e.key === 'p' || e.key === 'P') {
        togglePreview();
      } else if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) {
          restartGame();
        }
      } else if (e.key === 'm' || e.key === 'M') {
        if (!e.ctrlKey && !e.metaKey) {
          toggleSound();
        }
      }
    });

    // ═══════════════════════════════════════
    //  启动
    // ═══════════════════════════════════════
    updateGridInputUI();
    updateSoundState();

    // 预加载图片列表，按横竖版分类后加载首张
    buildImageLists(function () {
      var list = getActiveImageList();
      var firstImg = list.length > 0 ? list[0] : DEFAULT_IMG;
      loadImage(firstImg);
    });

  })();

