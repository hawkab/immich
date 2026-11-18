import { JobName } from 'src/enum.js';
import { ClusterGroupService } from 'src/services/cluster-group.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

describe('household face reconciliation', () => {
  it('retains native group administration permission and queues a seed-preserving rebuild', async () => {
    const { sut, mocks } = newTestService(ClusterGroupService);
    const id = newUuid();
    mocks.access.clusterGroup.checkOwnerAccess.mockResolvedValue(new Set([id]));
    await sut.reconcilePeople(authStub.admin, id);
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.FacialRecognitionQueueAll,
      data: { clusterGroupId: id, force: true, preserveNamed: true },
    });
  });

  it('does not rebuild an unrelated group', async () => {
    const { sut, mocks } = newTestService(ClusterGroupService);
    mocks.access.clusterGroup.checkOwnerAccess.mockResolvedValue(new Set());
    await expect(sut.reconcilePeople(authStub.admin, newUuid())).rejects.toThrow();
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });
});
