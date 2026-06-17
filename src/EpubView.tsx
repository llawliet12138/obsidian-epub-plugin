import { WorkspaceLeaf, FileView, TFile, TFolder, Menu, moment, normalizePath } from "obsidian";
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { EpubPluginSettings } from "./EpubPluginSettings";
import { EpubReader, EpubReaderControls, EpubSource } from "./EpubReader";

export const EPUB_FILE_EXTENSION = "epub";
export const VIEW_TYPE_EPUB = "epub";
export const ICON_EPUB = "doc-epub";

export class EpubView extends FileView {
  allowNoFile = true;
  private readerControls: EpubReaderControls | null = null;
  private packagePath: string | null = null;

  constructor(leaf: WorkspaceLeaf, private settings: EpubPluginSettings) {
    super(leaf);
  }

  onPaneMenu(menu: Menu, source: 'more-options' | 'tab-header' | string): void {
    menu.addItem((item) => {
      item
        .setTitle("Create new epub note")
        .setIcon("document")
        .onClick(async () => {
          const fileName = this.getFileName();
          let file = this.app.vault.getAbstractFileByPath(fileName);
          if (file == null || !(file instanceof TFile)) {
            file = await this.app.vault.create(fileName, this.getFileContent());
          }
          const fileLeaf = this.app.workspace.createLeafBySplit(this.leaf);
          fileLeaf.openFile(file as TFile, {
            active: true
          });
        });
    });
    menu.addSeparator();
    super.onPaneMenu(menu, source);
  }

  getFileName() {
    let filePath;
    const parentPath = this.getBookParentPath();

    if (this.settings.useSameFolder) {
      filePath = parentPath === '/' ? '/' : `${parentPath}/`;
    } else {
      filePath = this.settings.notePath.endsWith('/')
        ? this.settings.notePath
        : `${this.settings.notePath}/`;
    }

    return `${filePath}${this.getBookBaseName()}.md`;
  }

  getFileContent() {
    return `---
Tags: ${this.settings.tags}
Date: ${moment().toLocaleString()}
---

# ${this.getBookBaseName()}
`;
  }

  getState(): Record<string, unknown> {
    const state = super.getState();

    if (this.packagePath) {
      state.packagePath = this.packagePath;
    }

    return state;
  }

  async setState(state: any, result: any): Promise<void> {
    if (typeof state?.packagePath === 'string') {
      this.packagePath = normalizePath(state.packagePath);
      await this.loadPackagePath(this.packagePath);
      result.history = true;
      return;
    }

    this.packagePath = null;
    await super.setState(state, result);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.packagePath = null;
    ReactDOM.unmountComponentAtNode(this.contentEl);
    this.contentEl.empty();
    this.contentEl.addClass('epub-reader-root');

    const contents = await this.app.vault.adapter.readBinary(file.path);
    this.renderReader({
      url: contents,
    }, file.basename);
  }

  async loadPackagePath(packagePath: string): Promise<void> {
    ReactDOM.unmountComponentAtNode(this.contentEl);
    this.contentEl.empty();
    this.contentEl.addClass('epub-reader-root');

    const folder = this.app.vault.getAbstractFileByPath(packagePath);
    if (!(folder instanceof TFolder)) {
      throw new Error(`EPUB package folder not found: ${packagePath}`);
    }

    await this.app.vault.adapter.read(normalizePath(`${packagePath}/META-INF/container.xml`));
    this.renderReader(createPackageSource(packagePath, (path, type) => this.requestPackageResource(path, type)), folder.name.replace(/\.epub$/i, ''));
  }

  renderReader(source: EpubSource, title: string): void {
    ReactDOM.render(
      <EpubReader
        source={source}
        title={title}
        leaf={this.leaf}
        onControlsReady={(controls) => {
          this.readerControls = controls;
        }} />,
      this.contentEl
    );
  }

  async requestPackageResource(url: string, type?: string): Promise<Blob | string | Document | XMLDocument | ArrayBuffer | object> {
    const vaultPath = normalizePackageResourcePath(this.packagePath!, url);
    const requestType = type || getExtension(vaultPath);

    if (requestType === 'blob') {
      const contents = await this.app.vault.adapter.readBinary(vaultPath);
      return new Blob([contents], { type: getMimeType(vaultPath) });
    }

    if (requestType === 'binary') {
      return this.app.vault.adapter.readBinary(vaultPath);
    }

    const text = await this.app.vault.adapter.read(vaultPath);

    if (requestType === 'json') {
      return JSON.parse(text);
    }

    if (isXmlType(requestType)) {
      return new DOMParser().parseFromString(text, requestType === 'html' || requestType === 'htm' ? 'text/html' : 'application/xml');
    }

    return text;
  }

  onunload(): void {
    this.readerControls = null;
    ReactDOM.unmountComponentAtNode(this.contentEl);
  }

  nextPage(): void {
    this.readerControls?.nextPage();
  }

  previousPage(): void {
    this.readerControls?.previousPage();
  }

  increaseFontSize(): void {
    this.readerControls?.increaseFontSize();
  }

  decreaseFontSize(): void {
    this.readerControls?.decreaseFontSize();
  }

  resetFontSize(): void {
    this.readerControls?.resetFontSize();
  }

  cycleFontFamily(): void {
    this.readerControls?.cycleFontFamily();
  }

  openTableOfContents(): void {
    this.readerControls?.openTableOfContents();
  }

  toggleReaderControls(): void {
    this.readerControls?.toggleReaderControls();
  }

  getDisplayText() {
    return this.getBookBaseName();
  }

  canAcceptExtension(extension: string) {
    return extension == EPUB_FILE_EXTENSION;
  }

  getViewType() {
    return VIEW_TYPE_EPUB;
  }

  getIcon() {
    return ICON_EPUB;
  }

  getBookBaseName(): string {
    if (this.file) {
      return this.file.basename;
    }

    if (this.packagePath) {
      return this.packagePath.split('/').pop()?.replace(/\.epub$/i, '') || 'EPUB';
    }

    return 'No File';
  }

  getBookParentPath(): string {
    if (this.file?.parent) {
      return this.file.parent.path || '/';
    }

    if (this.packagePath) {
      const index = this.packagePath.lastIndexOf('/');
      return index >= 0 ? this.packagePath.slice(0, index) || '/' : '/';
    }

    return '/';
  }
}

function createPackageSource(packagePath: string, requestMethod: (url: string, type?: string) => Promise<Blob | string | Document | XMLDocument | ArrayBuffer | object>): EpubSource {
  return {
    url: `${normalizePath(packagePath)}/`,
    epubInitOptions: {
      openAs: 'directory',
      requestMethod: requestMethod as any,
      replacements: 'blobUrl',
    },
  };
}

function normalizePackageResourcePath(packagePath: string, url: string): string {
  const root = normalizePath(packagePath);
  const rootWithSlash = `${root}/`;
  const decodedUrl = decodeURIComponent(url).split(/[?#]/)[0];
  // Strip protocol+origin prefix before normalizePath, which would mangle ://
  const cleanUrl = decodedUrl.replace(/^[a-z][a-z0-9+\-.]*:\/\/[^/]+\//, '/');
  const normalizedUrl = normalizePath(cleanUrl).replace(/^\/+/, '');
  const rootIndex = normalizedUrl.indexOf(rootWithSlash);

  if (rootIndex >= 0) {
    return normalizedUrl.slice(rootIndex);
  }

  if (normalizedUrl.startsWith(rootWithSlash)) {
    return normalizedUrl;
  }

  return normalizePath(`${rootWithSlash}${normalizedUrl}`);
}

function getExtension(path: string): string {
  return path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || '';
}

function isXmlType(type: string): boolean {
  return ['xml', 'opf', 'ncx', 'xhtml', 'html', 'htm'].indexOf(type) > -1;
}

function getMimeType(path: string): string {
  const extension = getExtension(path);
  const mimeTypes: Record<string, string> = {
    css: 'text/css',
    gif: 'image/gif',
    html: 'text/html',
    htm: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    ncx: 'application/x-dtbncx+xml',
    opf: 'application/oebps-package+xml',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    xhtml: 'application/xhtml+xml',
    xml: 'application/xml',
  };

  return mimeTypes[extension] || 'application/octet-stream';
}
