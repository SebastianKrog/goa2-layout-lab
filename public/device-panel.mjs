export function initDevicePanel({
  selectedSituation,
  task,
  call,
  read,
  notify,
}) {
  const $ = (id) => document.getElementById(id);
  let situationId, activeId;
  function showLink(view) {
    activeId = view.id;
    $("deviceQR").src = view.qr;
    $("deviceURL").textContent = view.urls[0];
    $("deviceURL").href = view.urls[0];
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
  $("deviceSource").onchange = constrain;
  $("deviceForm").onsubmit = (event) => {
    event.preventDefault();
    void task(
      "Starting device website…",
      async () => {
        const mode = $("deviceLayout").value;
        const view = await call("device-open", {
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
      $("deviceSeat").replaceChildren(
        ...options.seats.map((seat) => {
          const option = document.createElement("option");
          option.value = seat.id;
          option.textContent = seat.name;
          return option;
        }),
      );
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
