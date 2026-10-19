// Test-only instrumentation is installed by the lab Vite config for both
// immutable references and the comparator. No production source is rewritten.
export function instrument(code, id) {
  // Windows Git checkouts may use CRLF; adapter anchors use LF.
  code = code.replaceAll("\r\n", "\n");
  const normalized = id.replaceAll("\\", "/").split("?")[0];
  if (normalized.endsWith("/ui/CheatPanel.tsx"))
    return code.replace(
      "<div className={styles.cheatPanel}>",
      "<div data-lab-cheats className={styles.cheatPanel}>",
    );
  if (normalized.endsWith("/ui/DeckViewer.tsx")) {
    return code.includes("<div className={embedded ?")
      ? code.replace(
          "<div className={embedded ? styles.embedded : styles.backdrop}",
          "<div data-lab-deck={hero.id} data-lab-embedded={embedded} className={embedded ? styles.embedded : styles.backdrop}",
        )
      : code.replace(
          "<div className={styles.backdrop}",
          "<div data-lab-deck={hero.id} data-lab-embedded={false} className={styles.backdrop}",
        );
  }
  if (normalized.endsWith("/ui/EventLog.tsx")) {
    return code.includes("<div className={embedded ?")
      ? code.replace(
          "<div className={embedded ? styles.embedded :",
          '<div data-lab-log={embedded ? "embedded" : "floating"} className={embedded ? styles.embedded :',
        )
      : code.replace(
          "<div className={`${styles.container}",
          '<div data-lab-log="floating" className={`${styles.container}',
        );
  }
  if (normalized.endsWith("/hud/CardCanvas.tsx")) {
    return code.replace(
      "<canvas\n",
      "<canvas data-lab-card={card.id} data-lab-card-name={card.name}\n",
    );
  }
  if (normalized.endsWith("/ui/CardRow.tsx")) {
    return code.replace(
      "<div\n      onClick={onClick}",
      "<div data-lab-card={card.id} data-lab-card-name={card.name} data-lab-selected={isSelected || undefined}\n      onClick={onClick}",
    );
  }
  if (normalized.endsWith("/mobile/MobileCardList.tsx")) {
    return code
      .replace(
        '<button type="button" aria-pressed={selectedId === card.id}',
        '<button data-lab-card={card.id} data-lab-card-name={card.name} data-lab-selected={selectedId === card.id || undefined} type="button" aria-pressed={selectedId === card.id}',
      )
      .replace(
        '<button type="button" aria-label={`Inspect ${card.name}`}',
        '<button data-lab-inspect-card={card.id} type="button" aria-label={`Inspect ${card.name}`}',
      );
  }
  if (normalized.endsWith("/mobile/MobileDecisionPanel.tsx")) {
    return code.replace(
      '<button type="button" aria-label={`Inspect ${card.name}`}',
      '<button data-lab-inspect-card={card.id} type="button" aria-label={`Inspect ${card.name}`}',
    );
  }
  if (normalized.endsWith("/mobile/MobileHeroCard.tsx")) {
    return code.replace(
      '<button type="button" aria-label={`Inspect ${card.name}`}',
      '<button data-lab-inspect-card={card.id} type="button" aria-label={`Inspect ${card.name}`}',
    );
  }
  if (normalized.endsWith("/mobile/MobileBoardSummary.tsx")) {
    return code.replace(
      '<button type="button" key={card.id}',
      '<button data-lab-inspect-card={card.id} type="button" key={card.id}',
    );
  }
  if (normalized.endsWith("/mobile/MobileRules.tsx")) {
    return code.replace(
      '<button type="button" className={styles.inlineSpell}',
      '<button data-lab-inspect-card={spell.id} type="button" className={styles.inlineSpell}',
    );
  }
  if (normalized.endsWith("/mobile/MobileHeroIndicators.tsx")) {
    return code
      .replace(
        '<button type="button" key="spells"',
        '<button data-lab-open-spells={hero.id} type="button" key="spells"',
      )
      .replace(
        '<button type="button" className={styles.combined}',
        '<button data-lab-open-spells={hero.spellbook != null ? hero.id : undefined} type="button" className={styles.combined}',
      );
  }
  if (normalized.endsWith("/mobile/MobileSpellBrowser.tsx")) {
    return code
      .replace(
        "className={styles.castBrowser}",
        "data-lab-mobile-spells={hero.id} data-lab-mobile-spell-selection={card?.id} className={styles.castBrowser}",
      )
      .replace(
        '<button type="button" key={spell.id}',
        '<button data-lab-preview-spell={spell.id} type="button" key={spell.id}',
      )
      .replace(
        '<button type="button" onClick={() => context?.inspect(card.id)}',
        '<button data-lab-inspect-card={card.id} type="button" onClick={() => context?.inspect(card.id)}',
      );
  }
  if (normalized.endsWith("/mobile/MobileInspection.tsx")) {
    return code
      .replace(
        "<div ref={dialog}",
        "<div data-lab-mobile-inspection={card.id} ref={dialog}",
      )
      .replace(
        "<div {...dialog}",
        "<div data-lab-mobile-inspection={card.id} {...dialog}",
      )
      .replace(
        "<div {...nestedDialog}",
        "<div data-lab-mobile-inspection={nested?.id} {...nestedDialog}",
      );
  }
  if (normalized.endsWith("/board3d/Board3D.tsx")) {
    const anchor =
      "const [hoveredCard, setHoveredCard] = useState<{ card: CardView; heroSlug: string } | null>(null);";
    if (!code.includes(anchor))
      throw new Error("Unsupported 3D inspection revision.");
    return (
      `import { useEffect as useLabEffect } from 'react';\n` +
      code.replace(
        anchor,
        `${anchor}
      useLabEffect(() => {
        const api = window.__GOA2_LAB_BRIDGE__ ||= {};
        const bridge = {
          get: () => ({ cardId: hoveredCard?.card.id || null, heroId: tooltipHero?.id || null, altHeld }),
          set: (value) => {
            const heroes = Object.values(view?.teams || {}).flatMap(t => t.heroes);
            if (value.heroId) {
              const hero = heroes.find(h => h.id === value.heroId);
              if (!hero) throw new Error('Hero absent from player-scoped view');
              setTooltipHero(hero);
            }
            if (value.cardId) {
              for (const hero of heroes) {
                const cards = [hero.hand, hero.deck, hero.played_cards, hero.discard_pile,
                  [hero.current_turn_card, hero.extra_turn_card, hero.ultimate_card]].filter(Array.isArray).flat();
                const card = cards.find(c => c?.id === value.cardId);
                if (card) { setHoveredCard({ card, heroSlug: hero.id.replace(/^hero_/, '') }); return; }
              }
              throw new Error('Card absent from player-scoped view');
            }
          }
        };
        api.inspection3d = bridge;
        return () => { if (api.inspection3d === bridge) delete api.inspection3d; };
      }, [hoveredCard, tooltipHero, view, altHeld]);`,
      )
    );
  }
  if (normalized.endsWith("/ui/HeroInfo.tsx")) {
    return code.replace(
      "<div className={styles.container}",
      "<div data-lab-hero={hero.id} className={styles.container}",
    );
  }
  if (normalized.endsWith("/board3d/CameraRig.tsx")) {
    const anchor = "const camera = useThree((s) => s.camera);";
    if (!code.includes(anchor))
      throw new Error(
        "Unsupported CameraRig revision: missing camera bridge anchor.",
      );
    return code.replace(
      anchor,
      `${anchor}
      useEffect(() => {
        const api = window.__GOA2_LAB_BRIDGE__ ||= {};
        const bridge = {
          get: () => ({ mode: '3d', position: camera.position.toArray(), up: camera.up.toArray(),
            target: controlsRef.current?.target.toArray(), fov: camera.fov, zoom: camera.zoom }),
          set: (value) => {
            const c = controlsRef.current;
            if (!c || !value.target) throw new Error('3D controls not ready');
            const damping = c.enableDamping;
            c.enableDamping = false; c.update();
            camera.position.fromArray(value.position); camera.up.fromArray(value.up);
            camera.fov = value.fov; camera.zoom = value.zoom; camera.updateProjectionMatrix();
            c.target.fromArray(value.target); c.update(); c.saveState(); c.enableDamping = damping;
          }
        };
        api.camera3d = bridge;
        return () => { if (api.camera3d === bridge) delete api.camera3d; };
      }, [camera]);`,
    );
  }
  if (normalized.endsWith("/board/useMapZoom.ts")) {
    const anchor =
      "const [transform, setTransform] = useState<MapTransform>(NO_ZOOM);";
    if (!code.includes(anchor))
      throw new Error(
        "Unsupported 2D camera revision: missing transform bridge anchor.",
      );
    return code.replace(
      anchor,
      `${anchor}
      useEffect(() => {
        const api = window.__GOA2_LAB_BRIDGE__ ||= {};
        const bridge = {
          get: () => {
            const r = containerRef.current?.getBoundingClientRect();
            return { mode: '2d', k: transform.k, x: transform.x / (r?.width || 1), y: transform.y / (r?.height || 1) };
          },
          set: (value) => {
            const r = containerRef.current?.getBoundingClientRect();
            if (!r?.width || !r?.height) throw new Error('2D board not ready');
            setTransform(clampPan({ k: value.k, x: value.x * r.width, y: value.y * r.height }, r));
          }
        };
        api.camera2d = bridge;
        return () => { if (api.camera2d === bridge) delete api.camera2d; };
      }, [transform]);`,
    );
  }
  return null;
}

export function instrumentScript(code) {
  const anchor = /window\.GOA2Mobile2D\s*=\s*\{/;
  if (!anchor.test(code) || !/\bboardRotation\b/.test(code))
    throw new Error("Unsupported userscript camera adapter.");
  return code.replace(
    anchor,
    `window.GOA2Mobile2D = {
    __labInspection: {
      get: () => ({ selectedHeroCard: uiState.selectedHeroCard, focusedHeroId: uiState.focusedHeroId }),
      set: (v) => { uiState.selectedHeroCard = v.selectedHeroCard || null;
        uiState.focusedHeroId = v.focusedHeroId || null; refresh(); },
    },
    __labRotation: {
      get: () => boardRotation ? { angle: boardRotation.angle,
        centerX: boardRotation.host.style.getPropertyValue('--m2-center-x'),
        centerY: boardRotation.host.style.getPropertyValue('--m2-center-y') } : null,
      set: (v) => { if (!boardRotation) throw new Error('Userscript board not ready');
        boardRotation.angle = v.angle;
        boardRotation.host.style.setProperty('--m2-center-x', v.centerX || '0px');
        boardRotation.host.style.setProperty('--m2-center-y', v.centerY || '0px'); boardRotation.sync(); }
    },`,
  );
}
