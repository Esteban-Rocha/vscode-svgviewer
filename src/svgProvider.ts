'use strict';

import * as vscode from 'vscode';
import fs = require('fs')

export function getSvgUri(uri: vscode.Uri) {
    if (uri.scheme === 'svg-preview') {
        return uri;
    }

    return uri.with({
        scheme: 'svg-preview',
        path: uri.path + '.rendered',
        query: uri.toString()
    });
}

export class SvgDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _waiting: boolean = false;

    public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        let sourceUri = vscode.Uri.parse(uri.query);
        console.log(sourceUri);
        return vscode.workspace.openTextDocument(sourceUri).then(document => this.snippet(document.getText()));
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public exist(uri: vscode.Uri): boolean {
        return vscode.workspace.textDocuments
            .find(x => x.uri.path === uri.path && x.uri.scheme === uri.scheme) !== undefined;
    }

    public update(uri: vscode.Uri) {
        if (!this._waiting) {
            this._waiting = true;
            setTimeout(() => {
                this._waiting = false;
                this._onDidChange.fire(uri);
            }, 300);
        }
    }

    protected snippet(properties): string {
        let showTransGrid = vscode.workspace.getConfiguration('svgviewer').get('transparencygrid');
        let transparencycolor = vscode.workspace.getConfiguration('svgviewer').get('transparencycolor');
        let transparencyGridCss = '';
        if (showTransGrid) {
            if (transparencycolor != null && transparencycolor !== "") {
                transparencyGridCss = `
<style type="text/css">
.svgbg img {
    background: `+ transparencycolor + `;
}
</style>`;
            } else {
                transparencyGridCss = `
<style type="text/css">
.svgbg img {
    background:initial;
    background-image: url(data:image/gif;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAeUlEQVRYR+3XMQ4AIQhEUTiU9+/hUGy9Wk2G8luDIS8EMWdmYvF09+JtEUmBpieCJiA96AIiiKAswEsik10JCCIoCrAsiGBPOIK2YFWt/knOOW5Nv/ykQNMTQRMwEERQFWAOqmJ3PIIIigIMahHs3ahZt0xCetAEjA99oc8dGNmnIAAAAABJRU5ErkJggg==);
    background-position: left,top;
}
</style>`;
            }
        }
        return `<!DOCTYPE html><html><head>${transparencyGridCss}</head><body><div class="svgbg"><img src="data:image/svg+xml,${encodeURIComponent(properties)}"></div></body></html>`;
    }
}

export class SvgFileContentProvider extends SvgDocumentContentProvider {
    filename: string;
    constructor(previewUri: vscode.Uri, filename: string) {
        super();
        this.filename = filename;
        vscode.workspace.createFileSystemWatcher(this.filename, true, false, true).onDidChange((e: vscode.Uri) => {
            this.update(previewUri);
        });
    }

    protected extractSnippet(): string {
        let fileText = fs.readFileSync(this.filename, 'utf8');
        let text = fileText ? fileText : '';
        return super.snippet(text);
    }
}

export class NewSvgDocumentContentProvider {

    protected snippet(properties): string {
        let showTransGrid = vscode.workspace.getConfiguration('svgviewer').get('transparencygrid');
        let transparencycolor = vscode.workspace.getConfiguration('svgviewer').get('transparencycolor');
        let transparencyGridCss = '';
        if (showTransGrid) {
            if (transparencycolor != null && transparencycolor !== "") {
                transparencyGridCss = `
<style type="text/css">
.svgbg img {
    background: `+ transparencycolor + `;
}
</style>`;
            } else {
                transparencyGridCss = `
<style type="text/css">
.svgbg img {
    background:initial;
    background-image: url(data:image/gif;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAeUlEQVRYR+3XMQ4AIQhEUTiU9+/hUGy9Wk2G8luDIS8EMWdmYvF09+JtEUmBpieCJiA96AIiiKAswEsik10JCCIoCrAsiGBPOIK2YFWt/knOOW5Nv/ykQNMTQRMwEERQFWAOqmJ3PIIIigIMahHs3ahZt0xCetAEjA99oc8dGNmnIAAAAABJRU5ErkJggg==);
    background-position: left,top;
}
</style>`;
            }
        }
        return `<!DOCTYPE html><html><head>${transparencyGridCss}</head><body><div class="svgbg"><img src="data:image/svg+xml,${encodeURIComponent(properties)}"></div></body></html>`;
    }

    public async provideTextDocumentContent(sourceUri: vscode.Uri): Promise<string> {
        const document = await vscode.workspace.openTextDocument(sourceUri);
        return this.snippet(document.getText);
    }
}

export class SvgPreviewWebviewManager {
    private readonly webviews = new Map<string, vscode.Webview>();

    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly contentProvider: NewSvgDocumentContentProvider
    ) {
        vscode.workspace.onDidSaveTextDocument(document => {
            this.update(document.uri);
        }, null, this.disposables);

        vscode.workspace.onDidChangeTextDocument(event => {
            this.update(event.document.uri);
        }, null, this.disposables);
    }

    public dispose(): void {
        while (this.disposables.length) {
            const item = this.disposables.pop();
            if (item) {
                item.dispose();
            }
        }
        this.webviews.clear();
    }

    public update(uri: vscode.Uri) {
        const webview = this.webviews.get(uri.fsPath);
        if (webview) {
            this.contentProvider.provideTextDocumentContent(uri).then(x => webview.html = x);
        }
    }

    public updateAll() {
        for (const resource of this.webviews.keys()) {
            const sourceUri = vscode.Uri.parse(resource);
            this.update(sourceUri);
        }
    }

    public create(
        resource: vscode.Uri,
        viewColumn: vscode.ViewColumn,
        previewTitle: string
    ) {
        const view = vscode.window.createWebview(
            previewTitle,
            viewColumn, { enableScripts: true });

        this.contentProvider.provideTextDocumentContent(resource).then(x => view.html = x);

        view.onMessage(e => {
            vscode.commands.executeCommand(e.command, ...e.args);
        });

        view.onBecameActive(() => {
            vscode.commands.executeCommand('setContext', 'svgPreview', true);
        });

        view.onBecameInactive(() => {
            vscode.commands.executeCommand('setContext', 'svgPreview', false);
        });

        this.webviews.set(resource.fsPath, view);
        return view;
    }
}