namespace TheMashup.Core;

/// <summary>Separate local library file; writes replace it only after a complete temporary file is written.</summary>
public sealed class FileLibraryStore(string path) : ILibraryStore
{
    private readonly string _path = path ?? throw new ArgumentNullException(nameof(path));

    public LibraryReadResult Read()
    {
        try { return new(true, File.ReadAllText(_path)); }
        catch (FileNotFoundException) { return new(true, null); }
        catch (DirectoryNotFoundException) { return new(true, null); }
        catch (Exception ex) when (IsStorageError(ex)) { return new(false, null); }
    }

    public bool TryWrite(string content)
    {
        string? temporary = null;
        try
        {
            var fullPath = Path.GetFullPath(_path);
            var directory = Path.GetDirectoryName(fullPath)!;
            Directory.CreateDirectory(directory);
            temporary = Path.Combine(directory, $".library-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(temporary, content);
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
