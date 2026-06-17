import * as React from "react";
import { useEffect, useRef, useState, useCallback } from 'react';
import { WorkspaceLeaf } from 'obsidian';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import type { BookOptions } from 'epubjs/types/book';
import type { Contents, Rendition } from 'epubjs';
import type { NavItem } from 'epubjs/types/navigation';
import useLocalStorageState from 'use-local-storage-state';

export interface EpubReaderControls {
  nextPage(): void;
  previousPage(): void;
  increaseFontSize(): void;
  decreaseFontSize(): void;
  resetFontSize(): void;
  cycleFontFamily(): void;
  openTableOfContents(): void;
  toggleReaderControls(): void;
}

export interface EpubSource {
  url: string | ArrayBuffer;
  epubInitOptions?: BookOptions;
}

const FONT_FAMILIES = [
  { label: 'Obsidian', value: 'var(--font-text), var(--font-text-theme), serif' },
  { label: 'Charter', value: 'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'System', value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' },
];

export const EpubReader = ({ source, title, leaf, onControlsReady }: {
  source: EpubSource;
  title: string;
  leaf: WorkspaceLeaf;
  onControlsReady?: (controls: EpubReaderControls | null) => void;
}) => {
  const [location, setLocation] = useLocalStorageState<string | number>(`epub-${title}`, { defaultValue: 0 });
  const renditionRef = useRef<Rendition | null>(null);
  const [fontSize, setFontSize] = useLocalStorageState<number>(`epub-font-size-${title}`, { defaultValue: 100 });
  const [fontFamilyIndex, setFontFamilyIndex] = useLocalStorageState<number>(`epub-font-family-${title}`, { defaultValue: 0 });
  const [toc, setToc] = useState<NavItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const wheelTimestampRef = useRef(0);

  const isDarkMode = document.body.classList.contains('theme-dark');

  const locationChanged = useCallback((epubcifi: string | number) => {
    setLocation(epubcifi);
  }, [setLocation]);

  const getThemeValue = useCallback((name: string, fallback: string) => {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  }, []);

  const injectContentTheme = useCallback((contents: Contents) => {
    const doc = contents.window.document;
    if (!doc.head || !doc.body) return;

    const textColor = getThemeValue('--text-normal', isDarkMode ? '#ffffff' : '#000000');
    const mutedColor = getThemeValue('--text-muted', isDarkMode ? '#b3b3b3' : '#666666');
    const accentColor = getThemeValue('--text-accent', getThemeValue('--interactive-accent', '#0a84ff'));
    let styleEl = doc.getElementById('obsidian-epub-reader-theme');

    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'obsidian-epub-reader-theme';
      doc.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      html,
      body {
        background: transparent !important;
        background-color: transparent !important;
        color: ${textColor} !important;
      }

      body > :is(div, section, article, main) {
        background: transparent !important;
        background-color: transparent !important;
      }

      a,
      a:visited {
        color: ${accentColor} !important;
      }

      small,
      figcaption,
      blockquote {
        color: ${mutedColor};
      }
    `;

    doc.documentElement.style.background = 'transparent';
    doc.body.style.background = 'transparent';
    doc.body.oncontextmenu = () => false;
  }, [getThemeValue, isDarkMode]);

  const updateTheme = useCallback((rendition: Rendition, theme: 'light' | 'dark') => {
    const themes = rendition.themes;
    themes.override('color', getThemeValue('--text-normal', theme === 'dark' ? '#fff' : '#000'));
    themes.override('background', 'transparent');

    const loadedContents = rendition.getContents() as unknown;
    if (Array.isArray(loadedContents)) {
      loadedContents.forEach((content) => injectContentTheme(content as Contents));
    }
  }, [getThemeValue, injectContentTheme]);

  const updateFontSize = useCallback((size: number) => {
    renditionRef.current?.themes.fontSize(`${size}%`);
  }, []);

  const updateFontFamily = useCallback((index: number) => {
    const fontFamily = FONT_FAMILIES[index % FONT_FAMILIES.length]?.value || FONT_FAMILIES[0].value;
    renditionRef.current?.themes.font(fontFamily);
  }, []);

  const resizeRendition = useCallback(() => {
    const readerStage = leaf.view.containerEl.querySelector('div.epub-reader-stage');
    if (!readerStage) return;

    const rect = readerStage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    renditionRef.current?.resize(rect.width, rect.height);
  }, [leaf]);

  useEffect(() => {
    updateFontSize(fontSize);
  }, [fontSize, updateFontSize]);

  useEffect(() => {
    updateFontFamily(fontFamilyIndex);
  }, [fontFamilyIndex, updateFontFamily]);

  useEffect(() => {
    const handleResize = () => {
      resizeRendition();
    };

    leaf.view.app.workspace.on('resize', handleResize);
    return () => leaf.view.app.workspace.off('resize', handleResize);
  }, [leaf, resizeRendition]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
      if (renditionRef.current) {
        updateTheme(renditionRef.current, theme);
      }
    });

    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [updateTheme]);

  const nextPage = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const previousPage = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const clampFontSize = useCallback((size: number) => Math.min(180, Math.max(80, size)), []);

  const increaseFontSize = useCallback(() => {
    setFontSize((current) => clampFontSize(current + 10));
  }, [clampFontSize, setFontSize]);

  const decreaseFontSize = useCallback(() => {
    setFontSize((current) => clampFontSize(current - 10));
  }, [clampFontSize, setFontSize]);

  const resetFontSize = useCallback(() => {
    setFontSize(100);
  }, [setFontSize]);

  const cycleFontFamily = useCallback(() => {
    setFontFamilyIndex((current) => (current + 1) % FONT_FAMILIES.length);
  }, [setFontFamilyIndex]);

  const openTableOfContents = useCallback(() => {
    setTocOpen(true);
  }, []);

  const toggleReaderControls = useCallback(() => {
    setControlsOpen((current) => !current);
  }, []);

  useEffect(() => {
    const controls: EpubReaderControls = {
      nextPage,
      previousPage,
      increaseFontSize,
      decreaseFontSize,
      resetFontSize,
      cycleFontFamily,
      openTableOfContents,
      toggleReaderControls,
    };

    onControlsReady?.(controls);
    return () => onControlsReady?.(null);
  }, [
    cycleFontFamily,
    decreaseFontSize,
    increaseFontSize,
    nextPage,
    onControlsReady,
    openTableOfContents,
    previousPage,
    resetFontSize,
    toggleReaderControls,
  ]);

  const displayTocItem = useCallback((href: string) => {
    renditionRef.current?.display(href);
    setTocOpen(false);
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const now = Date.now();
    if (now - wheelTimestampRef.current < 500) return;

    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!horizontal) return;

    wheelTimestampRef.current = now;
    if (event.deltaX > 0) {
      nextPage();
    } else if (event.deltaX < 0) {
      previousPage();
    }
  }, [nextPage, previousPage]);

  const readerStyles = isDarkMode ? darkReaderTheme : lightReaderTheme;

  return (
    <div className="epub-reader-shell" onWheel={handleWheel}>
      <div className="epub-reader-stage">
        <ReactReader
          title={title}
          showToc={false}
          location={location}
          locationChanged={locationChanged}
          tocChanged={(value: unknown) => setToc(Array.isArray(value) ? value as NavItem[] : [])}
          swipeable={false}
          getRendition={(rendition: Rendition) => {
            renditionRef.current = rendition;
            rendition.flow("paginated");
            rendition.spread("none");
            rendition.hooks.content.register((content: Contents) => {
              injectContentTheme(content);
            });
            updateTheme(rendition, isDarkMode ? 'dark' : 'light');
            updateFontSize(fontSize);
            updateFontFamily(fontFamilyIndex);
            window.requestAnimationFrame(resizeRendition);
          }}
          epubOptions={{
            allowPopups: true,
            flow: "paginated",
            manager: "default",
            spread: "none",
            overflow: "hidden",
          }}
          epubInitOptions={source.epubInitOptions}
          readerStyles={readerStyles}
          url={source.url}
        />
      </div>
      {controlsOpen && (
        <div className="epub-reader-controls" role="toolbar" aria-label="EPUB reader controls">
          <button type="button" onClick={decreaseFontSize}>A-</button>
          <button type="button" onClick={resetFontSize}>{fontSize}%</button>
          <button type="button" onClick={increaseFontSize}>A+</button>
          <button type="button" onClick={cycleFontFamily}>{FONT_FAMILIES[fontFamilyIndex % FONT_FAMILIES.length].label}</button>
          <button type="button" onClick={openTableOfContents}>TOC</button>
        </div>
      )}
      {tocOpen && (
        <div className="epub-reader-overlay" role="dialog" aria-label="Table of contents">
          <button className="epub-reader-overlay-backdrop" type="button" aria-label="Close table of contents" onClick={() => setTocOpen(false)} />
          <div className="epub-reader-toc">
            <div className="epub-reader-toc-header">
              <span>Table of contents</span>
              <button type="button" onClick={() => setTocOpen(false)}>Close</button>
            </div>
            <div className="epub-reader-toc-items">
              {toc.length > 0 ? renderTocItems(toc, displayTocItem) : <div className="epub-reader-toc-empty">No table of contents</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function renderTocItems(items: NavItem[], onSelect: (href: string) => void, depth = 0): React.ReactNode {
  return items.map((item) => (
    <React.Fragment key={`${item.href}-${item.label}`}>
      <button
        className="epub-reader-toc-item"
        style={{ paddingInlineStart: `${16 + depth * 16}px` }}
        type="button"
        onClick={() => onSelect(item.href)}
      >
        {item.label}
      </button>
      {item.subitems && item.subitems.length > 0 && renderTocItems(item.subitems, onSelect, depth + 1)}
    </React.Fragment>
  ));
}

const lightReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  container: {
    ...ReactReaderStyle.container,
    backgroundColor: 'transparent',
  },
  readerArea: {
    ...ReactReaderStyle.readerArea,
    backgroundColor: 'transparent',
    transition: undefined,
  },
  titleArea: {
    ...ReactReaderStyle.titleArea,
    display: 'none',
  },
  reader: {
    ...ReactReaderStyle.reader,
    inset: 0,
  },
  swipeWrapper: {
    ...ReactReaderStyle.swipeWrapper,
    cursor: 'default',
  },
  arrow: {
    ...ReactReaderStyle.arrow,
    display: 'none',
  },
  arrowHover: {
    ...ReactReaderStyle.arrowHover,
    color: 'transparent',
  },
};

const darkReaderTheme: IReactReaderStyle = {
  ...lightReaderTheme,
  readerArea: {
    ...lightReaderTheme.readerArea,
    backgroundColor: 'transparent',
    transition: undefined,
  },
};
