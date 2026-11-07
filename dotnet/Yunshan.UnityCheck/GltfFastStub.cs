// Signature stub of the glTFast API used by Yunshan.Runtime (compile check only).
using System.Threading;
using System.Threading.Tasks;
namespace GLTFast
{
    public class ImportSettings { }
    public class GltfImport
    {
        public Task<bool> Load(string url, ImportSettings importSettings = null, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task<bool> InstantiateMainSceneAsync(UnityEngine.Transform parent, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }
}
