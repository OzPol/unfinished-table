function associatedLegendre(l, m, x) {
  let current = 1;
  for (let k = 1; k <= m; k += 1) current *= -(2 * k - 1) * Math.sqrt(Math.max(0, 1 - x * x));
  if (l === m) return current;
  let next = x * (2 * m + 1) * current;
  for (let k = m + 2; k <= l; k += 1) {
    const advanced = ((2 * k - 1) * x * next - (k + m - 1) * current) / (k - m);
    current = next;
    next = advanced;
  }
  return next;
}

function orbitalSurface(l, m) {
  const resolution = 22;
  const vectors = [];
  let largest = 0;
  for (let row = 0; row <= resolution; row += 1) {
    const polar = Math.PI * row / resolution;
    for (let col = 0; col <= 2 * resolution; col += 1) {
      const azimuth = Math.PI * col / resolution;
      const realFactor = m < 0 ? Math.sin(-m * azimuth) : Math.cos(m * azimuth);
      const wave = associatedLegendre(l, Math.abs(m), Math.cos(polar)) * realFactor;
      const radius = Math.abs(wave);
      largest = Math.max(largest, radius);
      vectors.push({
        x: radius * Math.sin(polar) * Math.cos(azimuth),
        y: radius * Math.sin(polar) * Math.sin(azimuth),
        z: radius * Math.cos(polar),
        wave,
      });
    }
  }
  const faces = [];
  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < 2 * resolution; col += 1) {
      const first = row * (2 * resolution + 1) + col;
      faces.push([first, first + 1, first + 2 * resolution + 2, first + 2 * resolution + 1]);
    }
  }
  return { faces, vectors, largest: largest || 1 };
}

export function bindOrbital(canvas, selectSubshell, selectProjection, subshells) {
  const ctx = canvas.getContext("2d");
  let xAngle = -0.35;
  let yAngle = 0.56;
  let mesh;
  let pointer;
  let pending = false;

  function draw() {
    pending = false;
    const { faces, vectors, largest } = mesh;
    const size = Math.min(canvas.width, canvas.height) * .39 / largest;
    const cx = Math.cos(xAngle), sx = Math.sin(xAngle);
    const cy = Math.cos(yAngle), sy = Math.sin(yAngle);
    const points = vectors.map(({ x, y, z, wave }) => {
      const rotatedX = x * cy + z * sy;
      const rotatedZ = z * cy - x * sy;
      return [rotatedX * size + canvas.width / 2, (y * cx - rotatedZ * sx) * size + canvas.height / 2,
        (y * sx + rotatedZ * cx) / largest, wave];
    });
    const paths = faces.map(face => {
      const corners = face.map(index => points[index]);
      return { corners, depth: corners.reduce((sum, corner) => sum + corner[2], 0) / corners.length };
    }).sort((a, b) => a.depth - b.depth);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const { corners, depth } of paths) {
      const positive = corners.reduce((sum, corner) => sum + corner[3], 0) >= 0;
      const lightness = 46 + 20 * depth;
      ctx.fillStyle = positive ? `hsl(168 50% ${lightness}%)` : `hsl(248 55% ${lightness}%)`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(...corners[0].slice(0, 2));
      for (const [x, y] of corners.slice(1)) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function updateProjection(reset) {
    const { l } = subshells[Number(selectSubshell.value)];
    if (reset) {
      selectProjection.replaceChildren(...Array.from({ length: 2 * l + 1 }, (_, index) => {
        const m = index - l;
        return new Option(String(m), String(m), false, m === 0);
      }));
    }
    mesh = orbitalSurface(l, Number(selectProjection.value));
    draw();
  }

  function queueDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  }

  selectSubshell.addEventListener("change", () => updateProjection(true));
  selectProjection.addEventListener("change", () => updateProjection(false));
  canvas.addEventListener("pointerdown", event => {
    pointer = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer) return;
    yAngle += (event.clientX - pointer[0]) * .022;
    xAngle += (event.clientY - pointer[1]) * .022;
    pointer = [event.clientX, event.clientY];
    queueDraw();
  });
  canvas.addEventListener("lostpointercapture", () => { pointer = undefined; });
  canvas.addEventListener("keydown", event => {
    const delta = { ArrowLeft: [0, -.2], ArrowRight: [0, .2], ArrowUp: [-.2, 0], ArrowDown: [.2, 0] }[event.key];
    if (!delta) return;
    event.preventDefault();
    xAngle += delta[0];
    yAngle += delta[1];
    queueDraw();
  });
  updateProjection(true);
}
