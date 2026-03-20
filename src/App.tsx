import { useEffect, useRef, useState, useCallback } from "react";
import type NutrientViewerType from "@nutrient-sdk/viewer";
import type { Instance, AnnotationsUnion, DocumentOperations } from "@nutrient-sdk/viewer";
import "./App.css";

type OCGLayer = Awaited<ReturnType<Instance["createLayer"]>>;
type OCGItem = OCGLayer | { name?: string; layers?: OCGItem[] };

const USERS = [
  { name: "Alice", color: { r: 59, g: 130, b: 246 } },
  { name: "Bob", color: { r: 239, g: 68, b: 68 } },
  { name: "Charlie", color: { r: 34, g: 197, b: 94 } },
];

const BASE_URL = `${window.location.protocol}//${window.location.host}/`;

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<Instance | null>(null);
  const nutrientRef = useRef<typeof NutrientViewerType | null>(null);
  const [activeUser, setActiveUser] = useState(USERS[0]);
  const [status, setStatus] = useState("");
  const [layers, setLayers] = useState<OCGItem[]>([]);
  const [exportedBuffer, setExportedBuffer] = useState<ArrayBuffer | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [dragged, setDragged] = useState(false);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const panel = (e.target as HTMLElement).closest("[data-ocg-panel]");
    const rect = panel?.getBoundingClientRect();
    const origX = dragged ? panelPos.x : (rect?.left ?? 0);
    const origY = dragged ? panelPos.y : (rect?.top ?? 0);
    const startX = e.clientX;
    const startY = e.clientY;
    const controller = new AbortController();

    const preventScroll = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    document.addEventListener("touchmove", preventScroll, { passive: false, signal: controller.signal });

    document.addEventListener("pointermove", (e) => {
      setDragged(true);
      setPanelPos({
        x: origX + (e.clientX - startX),
        y: origY + (e.clientY - startY),
      });
    }, { signal: controller.signal });

    document.addEventListener("pointerup", () => controller.abort(), { signal: controller.signal });
    document.addEventListener("pointercancel", () => controller.abort(), { signal: controller.signal });
  }, [panelPos, dragged]);

  // Set creatorName on new annotations based on active user
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    instance.setAnnotationCreatorName(activeUser.name);
  }, [activeUser]);

  useEffect(() => {
    const container = containerRef.current;
    let cleanup = () => {};

    (async () => {
      const NutrientViewer = (await import("@nutrient-sdk/viewer")).default;
      nutrientRef.current = NutrientViewer;

      NutrientViewer.unload(container);

      if (container) {
        const instance = await NutrientViewer.load({
          container,
          document: "/nutrient-web-demo.pdf",
          baseUrl: BASE_URL,
          toolbarItems: [
            { type: "sidebar-layers" },
            { type: "spacer" },
            { type: "ink" },
            { type: "highlighter" },
            { type: "text-highlighter" },
            { type: "note" },
            { type: "text" },
            { type: "line" },
            { type: "rectangle" },
            { type: "ellipse" },
            { type: "polygon" },
            { type: "stamp" },
          ],
        });

        instanceRef.current = instance;
        instance.setAnnotationCreatorName(USERS[0].name);

        const initialLayers = await instance.getLayers();
        setLayers(initialLayers);
      }

      cleanup = () => {
        NutrientViewer.unload(container);
      };
    })();

    return cleanup;
  }, []);

  const createLayersAndExport = useCallback(async () => {
    const instance = instanceRef.current;
    const NutrientViewer = nutrientRef.current;
    if (!instance || !NutrientViewer) return;

    setStatus("Working...");

    try {
      // Collect annotations across all pages grouped by creator
      const pageCount = instance.totalPageCount;
      const byUser: Record<string, string[]> = {};

      for (let i = 0; i < pageCount; i++) {
        const annotations = await instance.getAnnotations(i);
        annotations.forEach((ann: AnnotationsUnion) => {
          const creator = ann.creatorName || "Unknown";
          if (!byUser[creator]) byUser[creator] = [];
          byUser[creator].push(ann.id);
        });
      }

      const userNames = Object.keys(byUser);

      if (userNames.length === 0) {
        setStatus("No annotations found. Annotate as different users first!");
        return;
      }

      const operations: DocumentOperations.FlattenAnnotationsOperation[] = [];

      for (const userName of userNames) {
        const layer = await instance.createLayer({ name: userName });
        operations.push({
          type: "flattenAnnotations",
          annotationIds: byUser[userName],
          targetLayerId: layer.ocgId,
        });
      }

      const buffer = await instance.exportPDFWithOperations(operations);

      setExportedBuffer(buffer);
      setStatus(
        `Exported ${userNames.length} layer(s): ${userNames.join(", ")}`
      );
    } catch (err: unknown) {
      console.error(err);
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const downloadExported = useCallback(() => {
    if (!exportedBuffer) return;
    const blob = new Blob([exportedBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annotated-with-layers.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }, [exportedBuffer]);

  const reloadWithExported = useCallback(async () => {
    const NutrientViewer = nutrientRef.current;
    if (!exportedBuffer || !NutrientViewer) return;

    await NutrientViewer.unload(containerRef.current);
    const reloaded = await NutrientViewer.load({
      container: containerRef.current!,
      document: exportedBuffer,
      baseUrl: BASE_URL,
      toolbarItems: [
        { type: "sidebar-layers" },
        { type: "spacer" },
        { type: "export-pdf" },
      ],
      initialViewState: new NutrientViewer.ViewState({
        sidebarMode: NutrientViewer.SidebarMode.LAYERS,
      }),
    });

    instanceRef.current = reloaded;
    setExportedBuffer(null);
    setStatus("Reloaded! Toggle layers in the sidebar.");

    const updatedLayers = await reloaded.getLayers();
    setLayers(updatedLayers);
  }, [exportedBuffer]);

  if (minimized) {
    return (
      <div style={{ position: "relative", height: "100%", width: "100%", overflow: "hidden" }}>
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
        <button
          onClick={() => setMinimized(false)}
          style={fabStyle}
          title="Show controls"
        >
          OCG
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", overflow: "hidden" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

      <div
        data-ocg-panel
        style={dragged
          ? { ...floatingPanelStyle, left: panelPos.x, top: panelPos.y, right: "auto", transform: "none" }
          : { ...floatingPanelStyle, left: "50%", bottom: 16, top: "auto", right: "auto", transform: "translateX(-50%)" }
        }
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              onPointerDown={onDragStart}
              style={{ fontSize: 16, color: "#999", cursor: "grab", userSelect: "none", lineHeight: 1, touchAction: "none" }}
            >
              &#x2630;
            </span>
            <h3 style={{ margin: 0, fontSize: 15 }}>OCG Layer Demo</h3>
          </div>
          <button onClick={() => setMinimized(true)} style={closeButtonStyle} title="Minimize">
            &minus;
          </button>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {/* Left column: user switching */}
          <div style={{ flex: 1 }}>
            <h4 style={sectionTitle}>Annotating as</h4>
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              {USERS.map((user) => (
                <button
                  key={user.name}
                  onClick={() => setActiveUser(user)}
                  style={{
                    ...userButtonStyle,
                    background: activeUser.name === user.name
                      ? `rgb(${user.color.r}, ${user.color.g}, ${user.color.b})`
                      : "#fff",
                    color: activeUser.name === user.name ? "#fff" : "#333",
                    borderColor: `rgb(${user.color.r}, ${user.color.g}, ${user.color.b})`,
                  }}
                >
                  {user.name}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "#999", margin: "2px 0 0" }}>
              Use the toolbar to annotate as {activeUser.name}.
            </p>
            {status && <p style={statusStyle}>{status}</p>}
          </div>

          {/* Right column: export + result */}
          <div style={{ flex: 1 }}>
            <h4 style={sectionTitle}>Export with Layers</h4>
            <button style={exportButtonStyle} onClick={createLayersAndExport}>
              Create Layers &amp; Export
            </button>
            {exportedBuffer && (
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <button style={{ ...exportButtonStyle, flex: 1, background: "#16a34a" }} onClick={reloadWithExported}>
                  Reload Viewer
                </button>
                <button style={{ ...buttonStyle, flex: 1 }} onClick={downloadExported}>
                  Download PDF
                </button>
              </div>
            )}
            {layers.length > 0 && (
              <>
                <h4 style={sectionTitle}>Layers</h4>
                <ul style={{ fontSize: 12, paddingLeft: 16, margin: 0, color: "#666" }}>
                  {layers.map((l, i) => (
                    <li key={i}>{"name" in l ? l.name || "Collection" : "Collection"}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

const floatingPanelStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: "min(520px, calc(100vw - 32px))",
  padding: 16,
  background: "rgba(255, 255, 255, 0.95)",
  backdropFilter: "blur(8px)",
  borderRadius: 10,
  boxShadow: "0 4px 24px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  zIndex: 1000,
  overflowY: "auto",
};

const fabStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: 48,
  height: 48,
  borderRadius: "50%",
  background: "#0066cc",
  color: "#fff",
  border: "none",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
  zIndex: 1000,
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 18,
  cursor: "pointer",
  color: "#999",
  padding: 0,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  margin: "12px 0 6px",
  color: "#999",
};

const userButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  border: "2px solid",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  transition: "all 0.15s",
};

const buttonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 10px",
  marginBottom: 6,
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

const exportButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  marginBottom: 6,
  border: "none",
  borderRadius: 6,
  background: "#0066cc",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const statusStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#0066cc",
  margin: "6px 0",
  padding: "6px 8px",
  background: "#e8f4fd",
  borderRadius: 6,
};
