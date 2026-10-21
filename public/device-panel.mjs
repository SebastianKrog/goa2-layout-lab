export function initDevicePanel({
  selectedSituation,
  task,
  call,
  read,
  notify,
}) {
  const $ = (id) => document.getElementById(id);
  let situationId, activeId;
  let seats = [],
    botKinds = [];
  const choices = new Map();
  const names = {
    manual: "Manual",
    random: "Random",
    heuristic: "Simple",
    ismcts: "ISMCTS",
  };
  function showLink(view) {
    activeId = view.id;
    $("deviceQR").src = view.qr;
    $("deviceURL").textContent = view.urls[0];
    $("deviceURL").href = view.urls[0];
    $("deviceRoster").textContent = (view.roster || seats)
      .filter((s) => s.id !== "spectator")
      .map(
        (s) =>
          `${s.name}: ${s.id === view.config.seat ? "You" : names[view.bots?.[s.id] || "manual"]}`,
      )
      .join(" | ");
    $("deviceLink").hidden = false;
  }
  async function refresh() {
    const views = await read("/api/device/views");
    $("deviceViews").replaceChildren(
      ...views.map((view) => {
        const row = document.createElement("p");
        const show = document.createElement("button");
        show.type = "button";
        show.textContent = `Show link: ${view.name}`;
        show.onclick = () => showLink(view);
        const stop = document.createElement("button");
        stop.type = "button";
        stop.textContent = "Stop sharing";
        stop.onclick = () =>
          void task(
            "Stopping device view…",
            async () => {
              await call("device-stop", { id: view.id });
              if (activeId === view.id) $("deviceLink").hidden = true;
              await refresh();
            },
            { sync: false },
          );
        row.append(show, stop);
        return row;
      }),
    );
  }
  function constrain() {
    const source = $("deviceSource").value;
    $("deviceLayout").querySelector('[value="mobile"]').disabled =
      source === "base" || source === "target";
    $("deviceLayout").querySelector('[value="3d"]').disabled =
      source === "target";
    if (
      (source === "base" || source === "target") &&
      $("deviceLayout").value === "mobile"
    )
      $("deviceLayout").value = "2d";
    if (source === "target" && $("deviceLayout").value === "3d")
      $("deviceLayout").value = "2d";
  }
  function renderBots() {
    const human = $("deviceSeat").value;
    const enabled = botKinds.length > 0 && human !== "spectator";
    $("deviceBots").hidden = !enabled;
    $("deviceBotsUnavailable").hidden = botKinds.length > 0;
    $("deviceBotRows").replaceChildren(
      ...seats
        .filter((s) => s.id !== human && s.id !== "spectator")
        .map((seat) => {
          const row = document.createElement("label");
          row.textContent = `${seat.name}${seat.team ? ` (${seat.team})` : ""}`;
          const select = document.createElement("select");
          select.dataset.botHero = seat.id;
          for (const kind of ["manual", ...botKinds]) {
            const option = document.createElement("option");
            option.value = kind;
            option.textContent = names[kind];
            select.append(option);
          }
          const preset = $("deviceBotPreset").value;
          select.value =
            choices.get(seat.id) || (preset === "custom" ? "manual" : preset);
          select.onchange = () => {
            choices.set(seat.id, select.value);
            $("deviceBotPreset").value = "custom";
          };
          row.append(select);
          return row;
        }),
    );
  }
  $("deviceBotPreset").onchange = () => {
    const kind = $("deviceBotPreset").value;
    if (kind === "custom") return;
    for (const seat of seats) choices.set(seat.id, kind);
    renderBots();
  };
  $("deviceSeat").onchange = renderBots;
  $("deviceSource").onchange = constrain;
  $("deviceForm").onsubmit = (event) => {
    event.preventDefault();
    void task(
      "Starting device website…",
      async () => {
        const mode = $("deviceLayout").value;
        const bots =
          botKinds.length && $("deviceSeat").value !== "spectator"
            ? Object.fromEntries(
                [...$("deviceBotRows").querySelectorAll("select")]
                  .filter((s) => s.value !== "manual")
                  .map((s) => [s.dataset.botHero, s.value]),
              )
            : {};
        const view = await call("device-open", {
          bots,
          situationId,
          restoreViews: $("deviceRestore").checked,
          slot: {
            source: $("deviceSource").value,
            seat: $("deviceSeat").value,
            render: mode === "3d" ? "3d" : "2d",
            layout: mode === "mobile" ? "mobile" : "desktop",
            profile: mode === "3d" ? "desktop" : "portrait",
          },
        });
        showLink(view);
        await refresh();
        notify("Device website ready. Scan its QR code.");
      },
      { sync: false },
    );
  };
  const open = async (id) => {
    try {
      situationId = id || selectedSituation()?.id;
      if (!situationId) throw Error("Choose a saved situation first.");
      const options = await read(
        `/api/device/options?situationId=${encodeURIComponent(situationId)}`,
      );
      seats = options.seats;
      botKinds = (options.botKinds || []).filter((kind) =>
        ["random", "heuristic", "ismcts"].includes(kind),
      );
      choices.clear();
      $("deviceSeat").replaceChildren(
        ...options.seats.map((seat) => {
          const option = document.createElement("option");
          option.value = seat.id;
          option.textContent = seat.name;
          return option;
        }),
      );
      renderBots();
      $("deviceLink").hidden = true;
      await refresh();
      constrain();
      $("deviceDialog").showModal();
    } catch (error) {
      notify(error.message);
    }
  };
  $("openDevice").onclick = () => void open();
  return open;
}
