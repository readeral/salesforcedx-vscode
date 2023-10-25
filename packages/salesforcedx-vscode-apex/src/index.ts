/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { getTestResultsFolder } from '@salesforce/salesforcedx-utils-vscode';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApexLanguageClient } from './apexLanguageClient';
import ApexLSPStatusBarItem from './apexLspStatusBarItem';
import { CodeCoverage, StatusBarToggle } from './codecoverage';
import {
  forceAnonApexDebug,
  forceAnonApexExecute,
  forceApexDebugClassRunCodeActionDelegate,
  forceApexDebugMethodRunCodeActionDelegate,
  forceApexLogGet,
  forceApexTestClassRunCodeAction,
  forceApexTestClassRunCodeActionDelegate,
  forceApexTestMethodRunCodeAction,
  forceApexTestMethodRunCodeActionDelegate,
  forceApexTestRun,
  forceApexTestSuiteAdd,
  forceApexTestSuiteCreate,
  forceApexTestSuiteRun,
  forceLaunchApexReplayDebuggerWithCurrentFile
} from './commands';
import { SET_JAVA_DOC_LINK } from './constants';
import { workspaceContext } from './context';
import * as languageServer from './languageServer';
import { languageServerOrphanHandler as lsoh } from './languageServerOrphanHandler';
import {
  ClientStatus,
  enableJavaDocSymbols,
  getApexTests,
  getExceptionBreakpointInfo,
  getLineBreakpointInfo,
  languageClientUtils
} from './languageUtils';
import { nls } from './messages';
import { telemetryService } from './telemetry';
import { TestNode, getTestOutlineProvider } from './views/testOutlineProvider';
import { ApexTestRunner, TestRunType } from './views/testRunner';

let languageClient: ApexLanguageClient | undefined;
const languageServerStatusBarItem = new ApexLSPStatusBarItem();

export async function activate(extensionContext: vscode.ExtensionContext) {
  const extensionHRStart = process.hrtime();
  const testOutlineProvider = getTestOutlineProvider();
  if (vscode.workspace && vscode.workspace.workspaceFolders) {
    const apexDirPath = getTestResultsFolder(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      'apex'
    );

    const testResultOutput = path.join(apexDirPath, '*.json');
    const testResultFileWatcher = vscode.workspace.createFileSystemWatcher(
      testResultOutput
    );
    testResultFileWatcher.onDidCreate(uri =>
      testOutlineProvider.onResultFileCreate(apexDirPath, uri.fsPath)
    );
    testResultFileWatcher.onDidChange(uri =>
      testOutlineProvider.onResultFileCreate(apexDirPath, uri.fsPath)
    );

    extensionContext.subscriptions.push(testResultFileWatcher);
  } else {
    throw new Error(nls.localize('cannot_determine_workspace'));
  }

  // Workspace Context
  await workspaceContext.initialize(extensionContext);

  // Telemetry
  await telemetryService.initializeService(extensionContext);

  // start the language server and client
  await createLanguageClient(extensionContext);

  // Javadoc support
  enableJavaDocSymbols();

  // Commands
  const commands = registerCommands();
  extensionContext.subscriptions.push(commands);

  extensionContext.subscriptions.push(await registerTestView());

  const exportedApi = {
    getLineBreakpointInfo,
    getExceptionBreakpointInfo,
    getApexTests,
    languageClientUtils
  };

  telemetryService.sendExtensionActivationEvent(extensionHRStart);
  return exportedApi;
}

function registerCommands(): vscode.Disposable {
  // Colorize code coverage
  const statusBarToggle = new StatusBarToggle();
  const colorizer = new CodeCoverage(statusBarToggle);
  const forceApexToggleColorizerCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.toggle.colorizer',
    () => colorizer.toggleCoverage()
  );

  // Customer-facing commands
  const forceApexTestClassRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.class.run.delegate',
    forceApexTestClassRunCodeActionDelegate
  );
  const forceApexTestLastClassRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.last.class.run',
    forceApexTestClassRunCodeAction
  );
  const forceApexTestClassRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.class.run',
    forceApexTestClassRunCodeAction
  );
  const forceApexTestMethodRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.method.run.delegate',
    forceApexTestMethodRunCodeActionDelegate
  );
  const forceApexDebugClassRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.debug.class.run.delegate',
    forceApexDebugClassRunCodeActionDelegate
  );
  const forceApexDebugMethodRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.debug.method.run.delegate',
    forceApexDebugMethodRunCodeActionDelegate
  );
  // TODO: remove forceApexAnonRunDelegateCmd
  // forceApexAnonRunDelegateCmd is a duplicate of forceAnonApexRunDelegateCmd
  // and needs to be removed after the Apex language server is updated.
  const forceApexAnonRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.anon.run.delegate',
    forceAnonApexExecute
  );
  const forceAnonApexRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.anon.apex.run.delegate',
    forceAnonApexExecute
  );
  const forceAnonApexDebugDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.anon.apex.debug.delegate',
    forceAnonApexDebug
  );
  const forceApexLogGetCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.log.get',
    forceApexLogGet
  );
  const forceApexTestLastMethodRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.last.method.run',
    forceApexTestMethodRunCodeAction
  );
  const forceApexTestMethodRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.method.run',
    forceApexTestMethodRunCodeAction
  );
  const forceApexTestSuiteCreateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.suite.create',
    forceApexTestSuiteCreate
  );
  const forceApexTestSuiteRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.suite.run',
    forceApexTestSuiteRun
  );
  const forceApexTestSuiteAddCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.suite.add',
    forceApexTestSuiteAdd
  );
  const forceApexTestRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.run',
    forceApexTestRun
  );
  const forceAnonApexExecuteDocumentCmd = vscode.commands.registerCommand(
    'sfdx.force.anon.apex.execute.document',
    forceAnonApexExecute
  );
  const forceAnonApexDebugDocumentCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.debug.document',
    forceAnonApexDebug
  );
  const forceAnonApexExecuteSelectionCmd = vscode.commands.registerCommand(
    'sfdx.force.anon.apex.execute.selection',
    forceAnonApexExecute
  );
  const forceLaunchApexReplayDebuggerWithCurrentFileCmd = vscode.commands.registerCommand(
    'sfdx.force.launch.apex.replay.debugger.with.current.file',
    forceLaunchApexReplayDebuggerWithCurrentFile
  );

  return vscode.Disposable.from(
    forceApexDebugClassRunDelegateCmd,
    forceApexDebugMethodRunDelegateCmd,
    forceApexAnonRunDelegateCmd,
    forceAnonApexRunDelegateCmd,
    forceAnonApexDebugDelegateCmd,
    forceAnonApexExecuteDocumentCmd,
    forceAnonApexExecuteSelectionCmd,
    forceAnonApexDebugDocumentCmd,
    forceLaunchApexReplayDebuggerWithCurrentFileCmd,
    forceApexLogGetCmd,
    forceApexTestClassRunCmd,
    forceApexTestClassRunDelegateCmd,
    forceApexTestLastClassRunCmd,
    forceApexTestLastMethodRunCmd,
    forceApexTestMethodRunCmd,
    forceApexTestMethodRunDelegateCmd,
    forceApexTestRunCmd,
    forceApexToggleColorizerCmd,
    forceApexTestSuiteCreateCmd,
    forceApexTestSuiteRunCmd,
    forceApexTestSuiteAddCmd
  );
}

function registerTestView(): Promise<vscode.Disposable> {
  const testOutlineProvider = getTestOutlineProvider();
  // Create TestRunner
  const testRunner = new ApexTestRunner(testOutlineProvider);

  // Test View
  const testViewItems = new Array<vscode.Disposable>();

  const testProvider = vscode.window.registerTreeDataProvider(
    'sfdx.force.test.view',
    testOutlineProvider
  );
  testViewItems.push(testProvider);

  // Run Test Button on Test View command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.force.test.view.run', () =>
      testRunner.runAllApexTests()
    )
  );
  // Show Error Message command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.force.test.view.showError', (test: TestNode) =>
      testRunner.showErrorMessage(test)
    )
  );
  // Show Definition command
  testViewItems.push(
    vscode.commands.registerCommand(
      'sfdx.force.test.view.goToDefinition',
      (test: TestNode) => testRunner.showErrorMessage(test)
    )
  );
  // Run Class Tests command
  testViewItems.push(
    vscode.commands.registerCommand(
      'sfdx.force.test.view.runClassTests',
      (test: TestNode) => testRunner.runApexTests([test.name], TestRunType.Class)
    )
  );
  // Run Single Test command
  testViewItems.push(
    vscode.commands.registerCommand(
      'sfdx.force.test.view.runSingleTest',
      (test: TestNode) => testRunner.runApexTests([test.name], TestRunType.Method)
    )
  );
  // Refresh Test View command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.force.test.view.refresh', () => {
      if (languageClientUtils.getStatus().isReady()) {
        return testOutlineProvider.refresh();
      }
    })
  );

  return Promise.resolve(vscode.Disposable.from(...testViewItems));
}

export function deactivate(): Promise<void> {
  telemetryService.sendExtensionDeactivationEvent();
  return Promise.resolve();
}

async function createLanguageClient(extensionContext: vscode.ExtensionContext) {
  // Initialize Apex language server
  try {
    const langClientHRStart = process.hrtime();
    languageClient = await languageServer.createLanguageServer(
      extensionContext
    );

    if (languageClient) {
      languageClient.onNotification('indexer/done', () => {
        void getTestOutlineProvider().refresh();
        languageServerReady();
      });
      languageClient.errorHandler?.addListener('error', (message: string) => {
        languageServerStatusBarItem.error(message);
      });
      languageClient.errorHandler?.addListener('restarting', (count: number) => {
        languageServerStatusBarItem.error(
          nls
            .localize('apex_language_server_quit_and_restarting')
            .replace('$N', `${count}`)
        );
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      languageClient.errorHandler?.addListener('startFailed', (count: number) => {
        languageServerStatusBarItem.error(
          nls.localize('apex_language_server_failed_activate')
        );
      });
    }

    languageClientUtils.setClientInstance(languageClient);

    void lsoh.resolveAnyFoundOrphanLanguageServers();

    await languageClient.start();

    const startTime = telemetryService.getEndHRTime(langClientHRStart);
    telemetryService.sendEventData('apexLSPStartup', undefined, {
      activationTime: startTime
    });
    languageClientUtils.setStatus(ClientStatus.Indexing, '');
    extensionContext.subscriptions.push(languageClient);
  } catch (err) {
    let eMsg =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
    languageClientUtils.setStatus(ClientStatus.Error, eMsg);
    if (
      eMsg.includes(nls.localize('wrong_java_version_text', SET_JAVA_DOC_LINK))
    ) {
      eMsg = nls.localize('wrong_java_version_short');
    }
    languageServerStatusBarItem.error(
      `${nls.localize('apex_language_server_failed_activate')} - ${eMsg}`
    );
  }
}

export function languageServerReady() {
  languageServerStatusBarItem.ready();
  languageClientUtils.setStatus(ClientStatus.Ready, '');
  languageClient?.errorHandler?.serviceHasStartedSuccessfully();
}
