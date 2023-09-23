/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Org, SfProject } from '@salesforce/core';
import {
  SourceTracking,
  SourceTrackingOptions
} from '@salesforce/source-tracking';
import { workspaceUtils } from '../workspaces';

/*
 * The SourceTrackingProvider class is used to instantiate
 * SourceTracking in the VSCE context and manage one instance
 * for each project.
 */
export class SourceTrackingProvider {
  protected sourceTrackers: Map<string, SourceTracking>;
  private static instance?: SourceTrackingProvider;

  public static getInstance() {
    if (SourceTrackingProvider.instance === undefined) {
      SourceTrackingProvider.instance = new SourceTrackingProvider();
    }
    return SourceTrackingProvider.instance;
  }

  private constructor() {
    this.sourceTrackers = new Map<string, SourceTracking>();
  }

  public async getSourceTracker(
    projectPath: string,
    connection: Connection
  ): Promise<SourceTracking> {
    const rootWorkspacePath = workspaceUtils.getRootWorkspacePath();
    let sourceTracker = this.sourceTrackers.get(rootWorkspacePath);
    if (!sourceTracker) {
      sourceTracker = await this.createSourceTracking(projectPath, connection);
      this.sourceTrackers.set(rootWorkspacePath, sourceTracker);
    }
    return sourceTracker;
  }

  /**
   * Creates an instance of SourceTracking with options
   * configured to work in VSCE.
   * Since SourceTracking is initialized with an SfProject, which
   * contains the project path, and PR #4643 made it so that VSCE is
   * running with process.cwd set as the project root, there
   * is no need to call process.chdir here as has been done in VSCE
   * with other core types like Config and ConfigAggregator.
   */
  private async createSourceTracking(
    projectPath: string,
    connection: Connection
  ): Promise<SourceTracking> {
    const project = await SfProject.resolve(projectPath);
    const org = await Org.create({ connection });
    const options: SourceTrackingOptions = {
      org,
      project,
      ignoreLocalCache: true,
      subscribeSDREvents: true,
      ignoreConflicts: true
    };
    const sourceTracking = await SourceTracking.create(options);
    return sourceTracking;
  }
}
