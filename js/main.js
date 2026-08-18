/* =============================================================================
   NIPON SAJIB — PORTFOLIO
   A 3D suitcase full of pokéballs, each one a section of the site.

   FILE MAP (this file):
     1.  Section + content config
     2.  Content loader (fetches & parses markdown, Jekyll-style frontmatter)
     3.  Router (hash-based, so every section/post/project has a shareable URL)
     4.  Audio (tiny original chiptune loop — muted until the user unmutes it)
     4b. Theme (dark / light popups only — the page itself is always dark)
     5.  Static section HTML (about / journey / contact)
     6.  Texture helpers (baked canvas textures — cheap, no runtime shader cost)
     7.  3D scene (suitcase + pokéballs)
     8.  Interaction (drag-to-rotate, click-to-open, floating labels)
     9.  Modal / UI rendering (lists, detail views, collection cards)
     10. Bootstrap (wires everything together on load)

   NOTE ON SERVING THIS SITE:
   The blog & project content is loaded from real markdown files under
   /content, the same way a static-site generator like Jekyll would. Browsers
   block fetch() of local files opened directly (file://), so this folder
   needs to be served over http to load that content — e.g. from this folder:
     npx serve .
   Everything else (the case, pokéballs, audio) works either way.
   ============================================================================= */

(function () {
  "use strict";

  /* ===========================================================================
     1. SECTION + CONTENT CONFIG
     Each pokéball maps to one entry here.
       - "static"     renders fixed HTML from buildStaticSections()
       - "single"     renders one markdown file (content/<file>.md)
       - "collection" renders a list of markdown files
                      (content/<contentDir>/<slug>.md), with a detail view
     =========================================================================== */
  const SECTIONS = [
    { id: "about", label: "About", eyebrow: "Case Item 01", kind: "static" },
    {
      id: "work",
      label: "Projects",
      eyebrow: "Case Item 02",
      kind: "collection",
      contentDir: "projects",
      slugs: ["placeholder", "prosthetic-grip"],
    },
    // Resume is edited by hand in content/resume.md — no code changes
    // needed to update it, just edit that file.
    {
      id: "resume",
      label: "Resume",
      eyebrow: "Case Item 03",
      kind: "single",
      file: "resume",
    },
    {
      id: "blog",
      label: "Blog",
      eyebrow: "Case Item 04",
      kind: "collection",
      contentDir: "blog",
      slugs: ["welcome-to-the-lab"],
    },
    {
      id: "contact",
      label: "Contact",
      eyebrow: "Case Item 05",
      kind: "static",
    },
  ];

  // 3 sockets in the back row, 2 in the front — matches the physical layout
  // built into the case geometry in section 7.
  const SOCKET_LAYOUT = [
    { x: -1.7, z: -0.85 },
    { x: 0, z: -0.85 },
    { x: 1.7, z: -0.85 },
    { x: -0.85, z: 0.65 },
    { x: 0.85, z: 0.65 },
  ];

  const sectionById = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

  /* ===========================================================================
     2. CONTENT LOADER
     Minimal frontmatter parser + markdown renderer (via the marked.js CDN
     library). Deliberately simple/dependency-light so it's easy to follow.
     =========================================================================== */
  const Content = (() => {
    const cache = {}; // "<dir>/<slug>" -> { slug, data, html }

    function parseFrontmatter(raw) {
      const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
      if (!match) return { data: {}, body: raw };
      const [, frontmatter, body] = match;
      const data = {};
      frontmatter.split("\n").forEach((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (value.startsWith("[") && value.endsWith("]")) {
          value = value
            .slice(1, -1)
            .split(",")
            .map((v) => v.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else {
          value = value.replace(/^["']|["']$/g, "");
        }
        data[key] = value;
      });
      return { data, body: body.trim() };
    }

    async function loadEntry(dir, slug) {
      const key = dir + "/" + slug;
      if (cache[key]) return cache[key];
      const path = `content/${dir ? dir + "/" : ""}${slug}.md`;
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Could not load ${path}`);
      const raw = await res.text();
      const { data, body } = parseFrontmatter(raw);
      const html = window.marked ? window.marked.parse(body) : `<p>${body}</p>`;
      const entry = { slug, data, html };
      cache[key] = entry;
      return entry;
    }

    // Order follows the "slugs" array in SECTIONS — curated newest-first by hand,
    // rather than auto-sorting human-readable dates (which don't sort reliably).
    async function loadCollection(dir, slugs) {
      const results = [];
      for (const slug of slugs) {
        try {
          results.push(await loadEntry(dir, slug));
        } catch (err) {
          console.warn(err.message);
        }
      }
      return results;
    }

    return { loadEntry, loadCollection };
  })();

  /* ===========================================================================
     3. ROUTER
     Hash-based routing so every section, blog post, and project has a
     shareable URL, e.g. #blog/building-a-diy-ecg-patch
     =========================================================================== */
  const Router = (() => {
    function parse() {
      const raw = location.hash.replace(/^#/, "");
      if (!raw) return null;
      const [section, slug] = raw.split("/");
      return sectionById[section] ? { section, slug: slug || null } : null;
    }
    function set(section, slug) {
      const next = "#" + section + (slug ? "/" + slug : "");
      if (location.hash !== next) history.pushState(null, "", next);
    }
    function clear() {
      if (location.hash)
        history.pushState(null, "", location.pathname + location.search);
    }
    return { parse, set, clear };
  })();

  /* ===========================================================================
     4. AUDIO
     A short, original 8-bit style loop synthesized with the Web Audio API —
     not a copyrighted recording. Silent until the visitor presses unmute,
     and the AudioContext itself is only created on that first interaction
     (also keeps us aligned with browser autoplay restrictions).
     =========================================================================== */
  const Chiptune = (() => {
    let ctx = null,
      masterGain = null,
      isPlaying = false,
      loopTimer = null;

    // Two original, simple public-domain-style phrases (not from any game).
    const LEAD = [
      659, 784, 880, 784, 659, 587, 523, 587, 659, 784, 880, 987, 880, 784, 659,
      587,
    ];
    const BASS = [165, 165, 196, 196, 220, 220, 165, 165];
    const STEP = 0.18; // seconds per lead step

    function ensureContext() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0;
        masterGain.connect(ctx.destination);
      }
      return ctx;
    }

    function pluck(freq, time, dur, type, vol) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(vol, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }

    function scheduleLoop() {
      const now = ctx.currentTime + 0.05;
      LEAD.forEach((freq, i) =>
        pluck(freq, now + i * STEP, STEP * 0.85, "square", 0.05),
      );
      BASS.forEach((freq, i) =>
        pluck(freq, now + i * STEP * 2, STEP * 1.7, "triangle", 0.07),
      );
      loopTimer = setTimeout(scheduleLoop, LEAD.length * STEP * 1000);
    }

    function toggle() {
      ensureContext();
      if (ctx.state === "suspended") ctx.resume();
      isPlaying = !isPlaying;
      if (isPlaying) {
        masterGain.gain.setTargetAtTime(0.5, ctx.currentTime, 0.05);
        scheduleLoop();
      } else {
        masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        clearTimeout(loopTimer);
      }
      return isPlaying;
    }

    return { toggle };
  })();

  /* ===========================================================================
     4b. THEME
     Sets the data-theme attribute the CSS variables in styles.css key off
     of (see §1 there) — this only recolors the pokéball popups, the page
     itself is always dark. Persisted in localStorage since this is a real
     site the visitor returns to, not a sandboxed artifact.
     =========================================================================== */
  const Theme = (() => {
    const KEY = "ns-theme";
    const DEFAULT = "light";
    const VALID = ["dark", "light"];

    function apply(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      try {
        localStorage.setItem(KEY, theme);
      } catch (err) {
        /* storage unavailable — theme just won't persist */
      }
    }

    function init(selectEl) {
      let saved = DEFAULT;
      try {
        saved = localStorage.getItem(KEY) || DEFAULT;
      } catch (err) {
        /* ignore */
      }
      if (!VALID.includes(saved)) saved = DEFAULT; // guards against a stale value from an older version
      apply(saved);
      if (selectEl) {
        selectEl.value = saved;
        selectEl.addEventListener("change", () => apply(selectEl.value));
      }
    }

    return { init, apply };
  })();

  /* ===========================================================================
     5. STATIC SECTION HTML
     About / Journey / Contact don't come from markdown — they're simple and
     personal enough to keep as plain templates here.
     =========================================================================== */
  function buildStaticSections() {
    return {
      about: {
        title: "About Me",
        body: `
          <p>I'm Nipon — a biomedical engineering student from the Bronx, NY, with three years of hands-on
          experience building wearable sensors and physiological monitoring tools. I like the parts of engineering
          that sit closest to an actual person.</p>
          <div class="fact-row">
            <div class="fact"><span class="k">Based in</span><span class="v">Bronx, NY</span></div>
            <div class="fact"><span class="k">Focus</span><span class="v">Biomedical Engineering</span></div>
            <div class="fact"><span class="k">Experience</span><span class="v">3 years</span></div>
            <div class="fact"><span class="k">Currently looking for</span><span class="v">An internship</span></div>
          </div>
          <p>Right now I'm specifically looking for an internship — somewhere I can bring
          engineering directly into everyday healthcare, not just build for it from a distance.</p>
        `,
      },
      contact: {
        title: "Get in Touch",
        body: `
          <p>Have a project in mind, or know of an opening in a school health office? My inbox is open.</p>
          <div class="contact-links">
            <a href="mailto:niponsajib@gmail.com">Email <span class="tag">niponsajib@gmail.com</span></a>
            <a href="https://github.com/niponsajib" target="_blank">GitHub <span class="tag">@niponsajib</span></a>
            <a href="https://linkedin.com/in/niponsajib" target="_blank">LinkedIn <span class="tag">/in/niponsajib</span></a>
          </div>
        `,
      },
    };
  }

  /* ===========================================================================
     6. TEXTURE HELPERS
     All textures are drawn once onto an offscreen <canvas> at startup and
     reused as static maps — no per-frame shader work, so this stays cheap.
     =========================================================================== */
  function makeCanvasTexture(size, draw) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  function buildDimpleBumpMap() {
    return makeCanvasTexture(256, (ctx, s) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, s, s);
      const step = 16;
      for (let y = 0; y < s; y += step) {
        for (let x = 0; x < s; x += step) {
          const cx = x + step / 2,
            cy = y + step / 2,
            r = step * 0.36;
          const grad = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, r);
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(0.55, "#9a9a9a");
          grad.addColorStop(1, "#4c4c4c");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  function buildFeltBumpMap() {
    return makeCanvasTexture(256, (ctx, s) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 3000; i++) {
        const v = 96 + Math.random() * 96;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
      }
    });
  }

  // Simple flat pokéball decal on a transparent background.
  function buildPokeballDecal() {
    return makeCanvasTexture(256, (ctx, s) => {
      const cx = s / 2,
        cy = s / 2,
        r = s * 0.42;
      ctx.clearRect(0, 0, s, s);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, Math.PI * 2);
      ctx.fillStyle = "#d8402a";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI);
      ctx.fillStyle = "#f1ead9";
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#14151a";
      ctx.fillRect(cx - r, cy - s * 0.045, r * 2, s * 0.09);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = "#14151a";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = "#f1ead9";
      ctx.fill();
      ctx.lineWidth = s * 0.02;
      ctx.strokeStyle = "#14151a";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  // Plain text stickers — deliberately generic (no school seal/logo is
  // reproduced here, just typography on a flat card) to stay clear of
  // any trademarked artwork.
  function buildTextSticker(lines, w, h, bg, fg) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const r = 14;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lineH = h / (lines.length + 1);
    lines.forEach((line, i) => {
      ctx.font = `${i === 0 ? "bold " : ""}${Math.floor(lineH * 0.6)}px 'Space Grotesk', sans-serif`;
      ctx.fillText(line, w / 2, lineH * (i + 1));
    });
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /* ===========================================================================
     7. 3D SCENE
     Builds the case (hollow tray + hinged lid + felt lining + metal top) and
     the 5 pokéballs, and exposes a small controller API used by the UI layer.
     =========================================================================== */
  function buildScene(host, caption) {
    const COLORS = {
      leather: 0x35383e,
      leatherDark: 0x232529,
      leatherLid: 0x3d4046,
      socket: 0x101113,
      steel: 0xb9bec6,
      steelDark: 0x7d828a,
      ballRed: 0xd8402a,
      cream: 0xf1ead9,
      ink: 0x14151a,
      felt: 0x22306b,
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1013);
    scene.fog = new THREE.Fog(0x0f1013, 10, 20);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const CAM_CLOSED = new THREE.Vector3(0, 6.1, 8.6);
    const CAM_OPEN = new THREE.Vector3(0, 7.0, 7.0);
    camera.position.copy(CAM_CLOSED);
    camera.lookAt(0, 1.3, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    function resize() {
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);

    // -- lighting --------------------------------------------------------
    scene.add(new THREE.HemisphereLight(0x6b7078, 0x0a0a0c, 0.55));
    const key = new THREE.DirectionalLight(0xffe9c8, 1.15);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd8402a, 0.25);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const rig = new THREE.Group();
    // Lifted off the floor: the drag-to-tilt rotation pivots around this
    // group's origin, and the case's front/back edges (~1.8 units from
    // that origin) swing low enough at the tilt limits to poke through
    // the floor if the pivot sits right at y=0. This clearance keeps the
    // lowest point comfortably above the ground plane through the full
    // tilt range (see the clamp in wireInteraction).
    rig.position.y = 0.7;
    scene.add(rig);

    // -- materials (built once, reused everywhere) ------------------------
    const leatherMat = new THREE.MeshStandardMaterial({
      color: COLORS.leather,
      roughness: 0.7,
      metalness: 0.05,
    });
    const leatherLidMat = new THREE.MeshStandardMaterial({
      color: COLORS.leatherLid,
      roughness: 0.65,
      metalness: 0.05,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: COLORS.steel,
      roughness: 0.3,
      metalness: 0.85,
    });
    const metalTopMat = new THREE.MeshStandardMaterial({
      color: COLORS.steel,
      roughness: 0.35,
      metalness: 0.9,
      bumpMap: buildDimpleBumpMap(),
      bumpScale: 0.015,
    });
    const feltMat = new THREE.MeshStandardMaterial({
      color: COLORS.felt,
      roughness: 0.95,
      metalness: 0,
      bumpMap: buildFeltBumpMap(),
      bumpScale: 0.01,
    });

    const CASE_W = 6,
      CASE_D = 3.6,
      BASE_H = 1.0,
      LID_H = 0.55;

    // -- base: a true hollow tray (floor + 4 walls), so the felt-lined
    //    interior sits in a real cavity rather than a solid block fighting
    //    it for depth ------------------------------------------------------
    const baseGroup = new THREE.Group();
    rig.add(baseGroup);

    const WALL_T = 0.16,
      FLOOR_T = 0.12;
    const wallH = BASE_H - FLOOR_T;
    const caseHitMeshes = [];

    const baseFloor = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, FLOOR_T, CASE_D),
      leatherMat,
    );
    baseFloor.position.y = FLOOR_T / 2;
    baseFloor.castShadow = baseFloor.receiveShadow = true;
    baseGroup.add(baseFloor);
    caseHitMeshes.push(baseFloor);

    const frontWall = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, wallH, WALL_T),
      leatherMat,
    );
    frontWall.position.set(0, FLOOR_T + wallH / 2, CASE_D / 2 - WALL_T / 2);
    const backWall = frontWall.clone();
    backWall.position.z = -CASE_D / 2 + WALL_T / 2;
    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_T, wallH, CASE_D - 2 * WALL_T),
      leatherMat,
    );
    leftWall.position.set(-CASE_W / 2 + WALL_T / 2, FLOOR_T + wallH / 2, 0);
    const rightWall = leftWall.clone();
    rightWall.position.x = CASE_W / 2 - WALL_T / 2;
    [frontWall, backWall, leftWall, rightWall].forEach((w) => {
      w.castShadow = w.receiveShadow = true;
      baseGroup.add(w);
      caseHitMeshes.push(w);
    });

    // thin steel piping along the top rim, for a less "blocky" premium edge
    [frontWall, backWall].forEach((w) => {
      const piping = new THREE.Mesh(
        new THREE.BoxGeometry(CASE_W, 0.04, WALL_T + 0.02),
        steelMat,
      );
      piping.position.set(0, BASE_H, w.position.z);
      baseGroup.add(piping);
    });

    // corner rivets
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].forEach(([sx, sz]) => {
      const riv = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 10),
        steelMat,
      );
      riv.position.set(
        sx * (CASE_W / 2 - 0.18),
        BASE_H - 0.1,
        sz * (CASE_D / 2 - 0.18),
      );
      baseGroup.add(riv);
    });

    // front clasps
    [-1, 1].forEach((sx) => {
      const clasp = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.28, 0.14),
        steelMat,
      );
      clasp.position.set(sx * 1.35, BASE_H - 0.05, CASE_D / 2 + 0.02);
      clasp.castShadow = true;
      baseGroup.add(clasp);
      const nub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10),
        steelMat,
      );
      nub.rotation.z = Math.PI / 2;
      nub.position.set(sx * 1.35, BASE_H - 0.05, CASE_D / 2 + 0.1);
      baseGroup.add(nub);
    });

    // royal blue felt lining the interior floor — this is the main surface
    // visible once the case is open (the lid has its own matching felt
    // lining on its underside, wired up further down)
    const FLOOR_FELT_H = 0.05;
    const floorFelt = new THREE.Mesh(
      new THREE.BoxGeometry(
        CASE_W - 2 * WALL_T - 0.06,
        FLOOR_FELT_H,
        CASE_D - 2 * WALL_T - 0.06,
      ),
      feltMat,
    );
    floorFelt.position.y = FLOOR_T + FLOOR_FELT_H / 2;
    floorFelt.receiveShadow = true;
    baseGroup.add(floorFelt);

    // top surface the pokéball sockets/lips/balls sit on
    const foamTopY = FLOOR_T + FLOOR_FELT_H;

    // -- pokéballs ---------------------------------------------------------
    const socketMat = new THREE.MeshStandardMaterial({
      color: COLORS.socket,
      roughness: 1,
    });
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0x2a2d24,
      roughness: 0.8,
    });
    const ballRadius = 0.46;
    const pokeballGroups = [];
    const pokeballById = {};

    // Each ball is two independently-movable pieces so the whole thing can
    // "pop open" the way it does in the show: the red top cap (with its own
    // slice of the black band) hinges open on a pivot at its back edge,
    // while the white bottom + rest of the band + button stay put as one
    // rigid piece — nothing floats apart from what it's attached to.
    function buildPokeball() {
      const group = new THREE.Group();
      const redMat = new THREE.MeshStandardMaterial({
        color: COLORS.ballRed,
        roughness: 0.4,
        metalness: 0.08,
      });
      const creamMat = new THREE.MeshStandardMaterial({
        color: COLORS.cream,
        roughness: 0.45,
        metalness: 0.05,
      });
      const inkMat = new THREE.MeshStandardMaterial({
        color: COLORS.ink,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });

      // stationary body: white hemisphere + full black band + button
      const bodyGroup = new THREE.Group();
      const bottom = new THREE.Mesh(
        new THREE.SphereGeometry(
          ballRadius,
          28,
          16,
          0,
          Math.PI * 2,
          Math.PI / 2,
          Math.PI / 2,
        ),
        creamMat,
      );
      bottom.castShadow = true;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(
          ballRadius * 1.03,
          ballRadius * 1.03,
          ballRadius * 0.22,
          28,
          1,
          true,
        ),
        inkMat,
      );

      const buttonGroup = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(
          ballRadius * 0.3,
          ballRadius * 0.3,
          0.03,
          24,
        ),
        inkMat,
      );
      disc.rotation.x = Math.PI / 2;
      disc.position.z = ballRadius * 0.99;
      // NOTE: TorusGeometry already lies flat in the XY plane (facing +Z) by
      // default — unlike the cylinders above it needs NO extra rotation.
      // Rotating it here was the bug that made it stand up like a stray hoop.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(ballRadius * 0.34, ballRadius * 0.045, 10, 24),
        steelMat,
      );
      ring.position.z = ballRadius * 1.0;
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(
          ballRadius * 0.19,
          ballRadius * 0.19,
          0.05,
          24,
        ),
        creamMat,
      );
      knob.rotation.x = Math.PI / 2;
      knob.position.z = ballRadius * 1.02;
      buttonGroup.add(disc, ring, knob);

      bodyGroup.add(bottom, band, buttonGroup);

      // hinged top cap: pivot sits at the back rim of the sphere so the cap
      // swings open like a real lid instead of just floating upward
      const topPivot = new THREE.Group();
      topPivot.position.set(0, 0, -ballRadius);
      const top = new THREE.Mesh(
        new THREE.SphereGeometry(
          ballRadius,
          28,
          16,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        redMat,
      );
      top.position.set(0, 0, ballRadius); // re-centers relative to the pivot
      top.castShadow = true;
      topPivot.add(top);

      group.add(bodyGroup, topPivot);
      group.rotation.x = -0.32; // tilts the button up toward the camera
      group.userData.parts = { topPivot, bodyGroup };
      return group;
    }

    SOCKET_LAYOUT.forEach((pos, i) => {
      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(ballRadius * 1.02, 0.035, 8, 28),
        lipMat,
      );
      lip.rotation.x = -Math.PI / 2;
      lip.position.set(pos.x, foamTopY + 0.02, pos.z);
      baseGroup.add(lip);
      const socket = new THREE.Mesh(
        new THREE.CircleGeometry(ballRadius * 1.0, 28),
        socketMat,
      );
      socket.rotation.x = -Math.PI / 2;
      socket.position.set(pos.x, foamTopY + 0.015, pos.z);
      baseGroup.add(socket);

      const ball = buildPokeball();
      // seated in the socket with a modest embed depth (not buried in it)
      ball.position.set(pos.x, foamTopY + ballRadius * 0.85, pos.z);
      ball.scale.setScalar(0.0001);
      const section = SECTIONS[i];
      ball.userData.sectionId = section.id;
      baseGroup.add(ball);
      pokeballGroups.push(ball);
      pokeballById[section.id] = ball;
    });

    // -- lid -----------------------------------------------------------
    // pivot lifted a hair above the wall rim so the closed lid never shares
    // an exact depth plane with the wall tops (the other source of flicker)
    const pivot = new THREE.Group();
    pivot.position.set(0, BASE_H + 0.004, -CASE_D / 2);
    rig.add(pivot);

    const lidShell = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, LID_H, CASE_D),
      leatherLidMat,
    );
    lidShell.position.set(0, LID_H / 2, CASE_D / 2);
    lidShell.castShadow = lidShell.receiveShadow = true;
    pivot.add(lidShell);
    caseHitMeshes.push(lidShell);

    // polished metal top plate (dimpled bump texture) sitting on the outer
    // face of the lid — this is what's visible when the case is closed
    const metalTop = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W - 0.1, 0.03, CASE_D - 0.1),
      metalTopMat,
    );
    metalTop.position.set(0, LID_H + 0.016, CASE_D / 2);
    pivot.add(metalTop);

    // royal blue felt lining on the inside face of the lid, visible once open
    const feltLining = new THREE.Mesh(
      new THREE.PlaneGeometry(CASE_W - 0.5, CASE_D - 0.5),
      feltMat,
    );
    feltLining.rotation.x = Math.PI / 2;
    feltLining.position.set(0, -0.015, CASE_D / 2);
    pivot.add(feltLining);

    // latch nubs
    [-1, 1].forEach((sx) => {
      const nub = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.16, 0.1),
        steelMat,
      );
      nub.position.set(sx * 1.35, 0.08, CASE_D - 0.02);
      pivot.add(nub);
    });

    // decorative stickers on the metal top: a small pokéball decal, a plain
    // text "school" sticker, and a "property of" tag. All drawn as flat
    // textures (see section 6) rather than reproducing any real logo/seal.
    function addDecal(texture, w, h, x, z, rotationY) {
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rotationY || 0;
      mesh.position.set(x, LID_H + 0.033, z);
      pivot.add(mesh);
    }
    addDecal(buildPokeballDecal(), 0.75, 0.75, -1.9, CASE_D / 2 + 0.9, 0.08);
    addDecal(
      buildTextSticker(
        ["STONY BROOK", "UNIVERSITY"],
        260,
        100,
        "#8c1d1d",
        "#f1ead9",
      ),
      1.575,
      0.63,
      0.6,
      CASE_D / 2 - 0.9,
      -0.04,
    );
    addDecal(
      buildTextSticker(
        ["PROPERTY OF", "SAJIB NIPON"],
        260,
        100,
        "#1a1c20",
        "#e9e7e2",
      ),
      1.5,
      0.6,
      1.9,
      CASE_D / 2 + 0.85,
      0.06,
    );

    resize();

    // -- flash sprite (pokéball "pop" effect) --------------------------
    const flashTex = makeCanvasTexture(128, (ctx, s) => {
      const grad = ctx.createRadialGradient(
        s / 2,
        s / 2,
        0,
        s / 2,
        s / 2,
        s / 2,
      );
      grad.addColorStop(0, "rgba(255,246,216,1)");
      grad.addColorStop(0.4, "rgba(255,246,216,0.6)");
      grad.addColorStop(1, "rgba(255,246,216,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
    });
    const flashMat = new THREE.SpriteMaterial({
      map: flashTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flashSprite = new THREE.Sprite(flashMat);
    flashSprite.scale.setScalar(0.001);
    baseGroup.add(flashSprite);

    // -- tween helper ----------------------------------------------------
    function animate(duration, ease, update, done) {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        update(ease(t));
        if (t < 1) requestAnimationFrame(step);
        else if (done) done();
      }
      requestAnimationFrame(step);
    }
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeOutBack = (t) => {
      const c1 = 1.70158,
        c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };

    // -- state -------------------------------------------------------------
    let caseOpen = false,
      isDragging = false,
      animBusy = false;
    const DEFAULT_RIG_ROTATION = { x: 0, y: 0 };

    function openCase(onDone) {
      if (animBusy || caseOpen) {
        if (onDone) onDone();
        return;
      }
      animBusy = true;
      caption.textContent = "";
      animate(
        950,
        easeOutCubic,
        (t) => {
          pivot.rotation.x = -2.02 * t;
        },
        () => {
          caseOpen = true;
          animBusy = false;
          caption.textContent = "Tap a pokéball to open it";
          // wait until every pokéball has fully popped up before straightening
          // the view, rather than resetting up front and having it visibly
          // drift again while the case is still mid-animation
          let spawned = 0;
          pokeballGroups.forEach((ball, i) => {
            setTimeout(
              () =>
                animate(
                  560,
                  easeOutBack,
                  (t) => ball.scale.setScalar(Math.max(0.0001, t)),
                  () => {
                    spawned++;
                    if (spawned === pokeballGroups.length) resetView();
                  },
                ),
              i * 110,
            );
          });
          if (onDone) onDone();
        },
      );
      animate(
        950,
        easeOutCubic,
        (t) => {
          camera.position.lerpVectors(CAM_CLOSED, CAM_OPEN, t);
          camera.lookAt(0, 1.8, 0);
        },
        null,
      );
    }

    function closeCase() {
      if (animBusy || !caseOpen) return;
      animBusy = true;
      caption.textContent = "";
      pokeballGroups.forEach((ball) => ball.scale.setScalar(0.0001));
      // clears any leftover #section/slug in the URL — a safety net so a
      // stale deep-link can never linger past the case actually closing
      Router.clear();
      animate(
        800,
        easeOutCubic,
        (t) => {
          pivot.rotation.x = -2.02 * (1 - t);
        },
        () => {
          caseOpen = false;
          animBusy = false;
          caption.textContent = "Drag to rotate · Tap the case to open it";
        },
      );
      animate(
        800,
        easeOutCubic,
        (t) => {
          camera.position.lerpVectors(CAM_OPEN, CAM_CLOSED, t);
          camera.lookAt(0, 1.3 * t + 1.8 * (1 - t), 0);
        },
        null,
      );
    }

    function popOpenBall(ball) {
      const { topPivot, bodyGroup } = ball.userData.parts;
      animate(
        460,
        easeOutBack,
        (t) => {
          topPivot.rotation.x = -2.1 * t;
          bodyGroup.position.y = -0.05 * Math.sin(Math.min(1, t) * Math.PI); // small settle/recoil
        },
        null,
      );
      const worldPos = new THREE.Vector3();
      ball.getWorldPosition(worldPos);
      baseGroup.worldToLocal(worldPos);
      flashSprite.position.copy(worldPos);
      flashSprite.position.y += ballRadius * 0.6;
      animate(
        520,
        (t) => t,
        (t) => {
          flashSprite.scale.setScalar(0.001 + t * 2.4);
          flashMat.opacity = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
        },
        null,
      );
    }

    function resetBall(ball) {
      const { topPivot, bodyGroup } = ball.userData.parts;
      animate(
        300,
        easeOutCubic,
        (t) => {
          topPivot.rotation.x = -2.1 * (1 - t);
          bodyGroup.position.y = 0;
        },
        null,
      );
    }

    function resetView() {
      animate(
        600,
        easeOutCubic,
        (t) => {
          rig.rotation.y =
            rig.rotation.y + (DEFAULT_RIG_ROTATION.y - rig.rotation.y) * t;
          rig.rotation.x =
            rig.rotation.x + (DEFAULT_RIG_ROTATION.x - rig.rotation.x) * t;
        },
        null,
      );
    }

    function tick() {
      // suppressing during animBusy too (not just caseOpen) is what stops
      // the idle spin from sneaking in during the ~950ms lid-opening
      // animation, before caseOpen flips true
      if (!isDragging && !caseOpen && !animBusy) rig.rotation.y += 0.0018;
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();

    return {
      scene,
      camera,
      renderer,
      rig,
      raycastTargets: {
        case: caseHitMeshes,
        lid: [lidShell],
        balls: pokeballGroups,
      },
      pokeballById,
      isCaseOpen: () => caseOpen,
      isBusy: () => animBusy,
      setDragging: (v) => {
        isDragging = v;
      },
      openCase,
      closeCase,
      popOpenBall,
      resetBall,
      resetView,
      resize,
    };
  }

  /* ===========================================================================
     8. INTERACTION
     Pointer drag-to-rotate, click-to-open raycasting, and the floating
     screen-space labels that hover under each pokéball.
     =========================================================================== */
  function wireInteraction(sceneApi, host, onOpenSection) {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0,
      downY = 0;

    function setNdc(e) {
      const rect = sceneApi.renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    host.addEventListener("pointerdown", (e) => {
      downX = e.clientX;
      downY = e.clientY;
      sceneApi.setDragging(true);
      host.classList.add("dragging");
      host.classList.remove("hoverable");
      host.setPointerCapture(e.pointerId);
    });

    host.addEventListener("pointermove", (e) => {
      if (!sceneApi.renderer) return;
      // dragging is tracked via classList; re-check each move
      if (!host.classList.contains("dragging")) {
        updateHoverCursor(e);
        return;
      }
      const dx = e.clientX - downX,
        dy = e.clientY - downY;
      sceneApi.rig.rotation.y += dx * 0.006;
      // clamped tighter than it might feel like it "should" be — this range
      // is what keeps the case's front/back edges from dipping through the
      // floor plane given the rig's fixed elevation (see rig.position.y above)
      sceneApi.rig.rotation.x = Math.max(
        -0.2,
        Math.min(0.3, sceneApi.rig.rotation.x + dy * 0.003),
      );
      downX = e.clientX;
      downY = e.clientY;
    });

    // swaps the "grab to rotate" cursor for a pointer whenever the mouse is
    // over something clickable — a pokéball once open, or the case/lid
    // otherwise — so it reads as clickable the way a normal button would.
    function updateHoverCursor(e) {
      if (sceneApi.isBusy()) return;
      setNdc(e);
      raycaster.setFromCamera(ndc, sceneApi.camera);
      const targets = sceneApi.isCaseOpen()
        ? [...sceneApi.raycastTargets.balls, ...sceneApi.raycastTargets.lid]
        : sceneApi.raycastTargets.case;
      const hit = raycaster.intersectObjects(targets, true).length > 0;
      host.classList.toggle("hoverable", hit);
    }

    function endDrag(e) {
      sceneApi.setDragging(false);
      host.classList.remove("dragging");
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved < 5) handleClick(e);
    }
    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", () => {
      sceneApi.setDragging(false);
      host.classList.remove("dragging");
    });
    host.addEventListener("pointerleave", () => {
      if (!host.classList.contains("dragging"))
        host.classList.remove("hoverable");
    });

    function findSectionRoot(obj) {
      let o = obj;
      while (o) {
        if (o.userData && o.userData.sectionId) return o;
        o = o.parent;
      }
      return null;
    }

    function handleClick(e) {
      if (sceneApi.isBusy()) return;
      setNdc(e);
      raycaster.setFromCamera(ndc, sceneApi.camera);

      if (!sceneApi.isCaseOpen()) {
        const hits = raycaster.intersectObjects(
          sceneApi.raycastTargets.case,
          true,
        );
        if (hits.length) sceneApi.openCase();
        return;
      }
      const ballHits = raycaster.intersectObjects(
        sceneApi.raycastTargets.balls,
        true,
      );
      if (ballHits.length) {
        const root = findSectionRoot(ballHits[0].object);
        if (root) {
          sceneApi.popOpenBall(root);
          onOpenSection(root.userData.sectionId, root);
        }
        return;
      }
      const lidHits = raycaster.intersectObjects(
        sceneApi.raycastTargets.lid,
        true,
      );
      if (lidHits.length) sceneApi.closeCase();
    }
  }

  // Projects each pokéball's world position into screen space every frame
  // and positions a matching HTML label under it.
  function wireLabels(sceneApi, host, sectionsMeta) {
    const container = document.createElement("div");
    container.style.cssText =
      "position:absolute; inset:0; pointer-events:none;";
    host.appendChild(container);

    const labels = {};
    sectionsMeta.forEach((s) => {
      const el = document.createElement("div");
      el.className = "ball-label";
      el.textContent = s.label;
      container.appendChild(el);
      labels[s.id] = el;
    });

    const v = new THREE.Vector3();
    function update() {
      const rect = host.getBoundingClientRect();
      Object.entries(sceneApi.pokeballById).forEach(([id, ball]) => {
        const el = labels[id];
        if (!el) return;
        const visible = sceneApi.isCaseOpen() && ball.scale.x > 0.5;
        el.classList.toggle("is-visible", visible);
        if (!visible) return;
        ball.getWorldPosition(v);
        v.y += 0.75; // float just above the ball
        v.project(sceneApi.camera);
        el.style.left = (v.x * 0.5 + 0.5) * rect.width + "px";
        el.style.top = (-v.y * 0.5 + 0.5) * rect.height + "px";
      });
      requestAnimationFrame(update);
    }
    update();
  }

  /* ===========================================================================
     9. MODAL / UI RENDERING
     =========================================================================== */
  function buildUI(sceneApi, staticSections, collectionsCache, singleEntries) {
    const backdrop = document.getElementById("backdrop");
    const modalPanel = document.getElementById("modalPanel");
    const modalContent = document.getElementById("modalContent");
    let lastFocused = null;
    let activeBallId = null;
    let currentView = null; // { sectionId, slug }

    function miniBallHead(eyebrow, title, withBack) {
      return `
        <div class="modal-head">
          ${withBack ? '<button class="modal-back" aria-label="Back to list">←</button>' : '<span class="mini-ball" aria-hidden="true"></span>'}
          <div><span class="modal-eyebrow">${eyebrow}</span><h2>${title}</h2></div>
          <button class="modal-close" aria-label="Close">✕</button>
        </div>`;
    }

    function renderCollectionList(sectionId, meta) {
      const entries = collectionsCache[sectionId] || [];
      if (!entries.length) {
        return `<div class="modal-body"><p>Nothing here yet — or this page was opened directly from disk. The blog and
        project write-ups load from markdown files and need this site to be served over http (e.g. <code>npx serve</code>
        from the project folder) rather than opened as a local file.</p></div>`;
      }
      const cards = entries
        .map(
          (entry) => `
        <div class="preview-card" tabindex="0" role="button" data-slug="${entry.slug}">
          <img src="${entry.data.image || ""}" alt="" loading="lazy">
          <div class="pc-body">
            <h3>${entry.data.title || entry.slug}</h3>
            <div class="pc-meta">${entry.data.date || ""}${entry.data.author ? " · " + entry.data.author : ""}</div>
            <p>${entry.data.summary || ""}</p>
            <div class="tag-row">${(entry.data.tags || []).map((t) => `<span class="chip">${t}</span>`).join("")}</div>
          </div>
        </div>`,
        )
        .join("");
      return `<div class="modal-body"><div class="card-grid">${cards}</div></div>`;
    }

    function renderDetail(entry) {
      const tags = (entry.data.tags || [])
        .map((t) => `<span class="chip accent">${t}</span>`)
        .join("");
      return `
        <div class="modal-body">
          ${entry.data.image ? `<img class="detail-image" src="${entry.data.image}" alt="">` : ""}
          <div class="detail-meta">${entry.data.date || ""}${entry.data.author ? " · " + entry.data.author : ""}</div>
          <div class="tag-row" style="margin-bottom:14px;">${tags}</div>
          <div class="detail-body">${entry.html}</div>
        </div>`;
    }

    function render(view) {
      currentView = view;
      const meta = getSectionMeta(view.sectionId);
      if (meta.kind === "static") {
        const s = staticSections[view.sectionId];
        modalContent.innerHTML =
          miniBallHead(meta.eyebrow, s.title, false) +
          `<div class="modal-body">${s.body}</div>`;
      } else if (meta.kind === "single") {
        // rendered straight from a markdown file (see content/resume.md) —
        // no back button since there's no list view to go back to
        const entry = singleEntries[view.sectionId];
        const linkBtn =
          entry && entry.data.resume_link
            ? `<a class="resume-link-btn" href="${entry.data.resume_link}" target="_blank" rel="noopener noreferrer">
               📄 View live resume in Google Docs <span class="arrow">→</span>
             </a>`
            : "";
        const body = entry
          ? `<div class="modal-body">${linkBtn}<div class="detail-body">${entry.html}</div></div>`
          : `<div class="modal-body"><p>Couldn't load this section's content file. If you opened this page directly
             from disk, serve it over http instead (e.g. <code>npx serve</code> from the project folder).</p></div>`;
        modalContent.innerHTML =
          miniBallHead(
            meta.eyebrow,
            (entry && entry.data.title) || meta.label,
            false,
          ) + body;
      } else {
        const entries = collectionsCache[view.sectionId] || [];
        const entry = view.slug
          ? entries.find((e) => e.slug === view.slug)
          : null;
        if (entry) {
          modalContent.innerHTML =
            miniBallHead(
              `${meta.eyebrow} · ${meta.label}`,
              entry.data.title || entry.slug,
              true,
            ) + renderDetail(entry);
        } else {
          modalContent.innerHTML =
            miniBallHead(meta.eyebrow, meta.label, false) +
            renderCollectionList(view.sectionId, meta);
        }
      }
      wireModalControls(view);
    }

    // (deliberately named differently from the module-level `sectionById`
    // lookup used by the Router, to avoid two same-named things in scope)
    function getSectionMeta(id) {
      return SECTIONS.find((s) => s.id === id);
    }

    function wireModalControls(view) {
      const closeBtn = modalContent.querySelector(".modal-close");
      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      const backBtn = modalContent.querySelector(".modal-back");
      if (backBtn)
        backBtn.addEventListener("click", () => navigate(view.sectionId, null));
      modalContent.querySelectorAll(".preview-card").forEach((card) => {
        const open = () =>
          navigate(view.sectionId, card.getAttribute("data-slug"));
        card.addEventListener("click", open);
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
      });
    }

    // navigate() is the single entry point for changing what the modal shows;
    // it updates the URL to match so every view is shareable.
    function navigate(sectionId, slug, opts) {
      opts = opts || {};
      render({ sectionId, slug });
      if (!opts.fromRouter) Router.set(sectionId, slug);
    }

    function openSection(sectionId, slug, fromRouter) {
      lastFocused = document.activeElement;
      activeBallId = sectionId;
      // Direct pokéball clicks always pass slug=null here, which forces the
      // list view AND overwrites the URL hash (via navigate -> Router.set)
      // even if it still had an old post/project slug in it from earlier —
      // that stale-hash mismatch was the actual bug: clicking a pokéball
      // fresh could still show whatever detail view the leftover URL
      // pointed at. Only applyRoute() (a real shared link, or the page
      // loading with a hash already in the URL) passes a real slug through.
      navigate(sectionId, slug || null, { fromRouter });
      backdrop.classList.add("is-active");
      modalPanel.focus();
    }

    function closeModal() {
      backdrop.classList.remove("is-active");
      if (activeBallId) {
        sceneApi.resetBall(sceneApi.pokeballById[activeBallId]);
        activeBallId = null;
      }
      Router.clear();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && backdrop.classList.contains("is-active"))
        closeModal();
    });

    return {
      openSection,
      navigate,
      closeModal,
      isOpen: () => backdrop.classList.contains("is-active"),
    };
  }

  /* ===========================================================================
     10. BOOTSTRAP
     =========================================================================== */
  document.addEventListener("DOMContentLoaded", async () => {
    // fade + slide the whole page in together
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.body.classList.add("is-ready")),
    );

    // background heartbeat waveform (see index.html for the row markup)
    (function drawHeartbeat() {
      const unit = 400,
        base = 60,
        reps = 6;
      const cycle = [
        [0, base],
        [46, base],
        [62, base],
        [70, base - 12],
        [78, base + 20],
        [86, base - 6],
        [94, base],
        [112, base],
        [126, base - 44],
        [138, base + 56],
        [150, base],
        [170, base],
        [400, base],
      ];
      let d = `M0,${base} `;
      for (let r = 0; r < reps; r++)
        cycle.forEach(([x, y]) => {
          d += `L${x + r * unit},${y} `;
        });
      document
        .querySelectorAll(".hb-path")
        .forEach((p) => p.setAttribute("d", d));
    })();

    // avatar — swap in a real photo any time by replacing
    // assets/avatar-placeholder.svg (or editing the <img src> in
    // index.html). Falls back to initials if the image fails to load.
    const avatarImg = document.getElementById("avatarImg");
    if (avatarImg) {
      avatarImg.addEventListener(
        "error",
        () => {
          const avatarEl = document.getElementById("avatar");
          if (avatarEl) {
            avatarImg.remove();
            const fallback = document.createElement("span");
            fallback.className = "avatar-fallback";
            fallback.textContent = "NS";
            avatarEl.appendChild(fallback);
          }
        },
        { once: true },
      );
    }

    // theme (dark / light popups only — the page itself is always dark)
    Theme.init(document.getElementById("themeSelect"));

    // audio toggle
    const audioBtn = document.getElementById("audioToggle");
    if (audioBtn) {
      audioBtn.addEventListener("click", () => {
        const playing = Chiptune.toggle();
        audioBtn.dataset.playing = String(playing);
        audioBtn.textContent = playing ? "🔊" : "🔈";
        audioBtn.setAttribute(
          "aria-label",
          playing ? "Mute background music" : "Unmute background music",
        );
      });
    }

    if (!window.THREE) {
      const fb = document.getElementById("fallback");
      if (fb) fb.style.display = "flex";
      return;
    }

    const host = document.getElementById("canvasHost");
    const caption = document.getElementById("caption");
    const sceneApi = buildScene(host, caption);

    const staticSections = buildStaticSections();

    // kick off markdown loading in parallel with everything else
    const collectionsCache = {};
    const singleEntries = {};
    await Promise.all([
      ...SECTIONS.filter((s) => s.kind === "collection").map(async (s) => {
        collectionsCache[s.id] = await Content.loadCollection(
          s.contentDir,
          s.slugs,
        );
      }),
      ...SECTIONS.filter((s) => s.kind === "single").map(async (s) => {
        try {
          singleEntries[s.id] = await Content.loadEntry("", s.file);
        } catch (err) {
          console.warn(err.message);
          singleEntries[s.id] = null;
        }
      }),
    ]);

    const ui = buildUI(
      sceneApi,
      staticSections,
      collectionsCache,
      singleEntries,
    );

    wireInteraction(sceneApi, host, (sectionId) =>
      ui.openSection(sectionId, null, false),
    );
    wireLabels(sceneApi, host, SECTIONS);

    // reset view / open-close buttons
    const resetBtn = document.getElementById("resetViewBtn");
    if (resetBtn)
      resetBtn.addEventListener("click", () => sceneApi.resetView());
    const toggleCaseBtn = document.getElementById("toggleCaseBtn");
    if (toggleCaseBtn) {
      toggleCaseBtn.addEventListener("click", () => {
        if (sceneApi.isCaseOpen()) sceneApi.closeCase();
        else sceneApi.openCase();
      });
    }

    // apply whatever route is in the URL on load, and on back/forward.
    // Always pops the matching pokéball open too (not just for slug routes)
    // so a shared link looks the same as if you'd clicked it by hand.
    function applyRoute() {
      const route = Router.parse();
      if (!route) return;
      const ball = sceneApi.pokeballById[route.section];
      const afterOpen = () => {
        // small delay so this runs after the pokéballs finish popping up
        // out of their sockets, instead of overlapping that animation
        setTimeout(() => {
          ui.openSection(route.section, route.slug, true);
          if (ball) sceneApi.popOpenBall(ball);
        }, 550);
      };
      if (!sceneApi.isCaseOpen()) sceneApi.openCase(afterOpen);
      else afterOpen();
    }
    window.addEventListener("popstate", applyRoute);
    applyRoute();
  });
})();
