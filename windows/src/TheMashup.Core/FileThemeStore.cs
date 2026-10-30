namespace TheMashup.Core;

/// <summary>Small local preference file. Replace only after the new value is fully written.</summary>
public sealed class FileThemeStore(string path) : IThemeStore
{
    private readonly string _path = path ?? throw new ArgumentNullException(nameof(path));

    public string? Read()
    {
        try { return File.Exists(_path) ? File.ReadAllText(_path).Trim() : null; }
        catch (Exception ex) when (IsStorageError(ex)) { return null; }
    }

    public bool TryWrite(string themeId)
    {
        string? temporary = null;
        try
        {
            var fullPath = Path.GetFullPath(_path);
            var directory = Path.GetDirectoryName(fullPath)!;
            Directory.CreateDirectory(directory);
            temporary = Path.Combine(directory, $".appearance-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(temporary, themeId);
            File.Move(temporary, fullPath, overwrite: true);
            temporary = null;
            return true;
        }
        catch (Exception ex) when (IsStorageError(ex)) { return false; }
        finally
        {
            if (temporary is not null)
            {
                try { File.Delete(temporary); }
                catch (Exception ex) when (IsStorageError(ex)) { }
            }
        }
    }

    private static bool IsStorageError(Exception ex) =>
        ex is IOException or UnauthorizedAccessException or System.Security.SecurityException
            or ArgumentException or NotSupportedException;
}
