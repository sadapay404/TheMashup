using System.Text;
using System.Text.Json;
using TheMashup.Core;

namespace TheMashup.Desktop;

internal sealed class WindowsAccountStore(string path) : IAccountStore
{
    public AccountSnapshot? Read()
    {
        if (!File.Exists(path)) return null;
        var protectedBytes = Convert.FromBase64String(File.ReadAllText(path).Trim());
        var plain = WindowsDpapi.Unprotect(protectedBytes);
        return JsonSerializer.Deserialize<AccountSnapshot>(Encoding.UTF8.GetString(plain));
    }

    public bool TryWrite(AccountSnapshot snapshot)
    {
        var plain = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot));
        var protectedBytes = WindowsDpapi.Protect(plain);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
        File.WriteAllText(path, Convert.ToBase64String(protectedBytes));
        return true;
    }

    public bool TryDelete()
    {
        if (File.Exists(path)) File.Delete(path);
        return true;
    }
}
