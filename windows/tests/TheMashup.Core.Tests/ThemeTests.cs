using TheMashup.Core;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class ThemeTests
{
    [Fact]
    public void CatalogContainsExactlyTheFiveExistingThemeIds()
    {
        Assert.Equal(new[] { "frosted", "paper-ink", "neon", "aurora", "vinyl" },
            ThemeCatalog.All.Select(theme => theme.Id));
        Assert.Equal(5, ThemeCatalog.All.Select(theme => theme.Name).Distinct().Count());
        Assert.Equal("frosted", ThemeCatalog.Default.Id);
    }

    [Theory]
    [InlineData("frosted")]
    [InlineData("paper-ink")]
    [InlineData("neon")]
    [InlineData("aurora")]
    [InlineData("vinyl")]
    public void SelectionIsSavedAndRestoredForEveryTheme(string id)
    {
        var store = new MemoryStore();
        var firstRun = new ThemeSelection(store);
        Assert.True(firstRun.Select(id));
        Assert.True(firstRun.LastWriteSucceeded);
        Assert.Equal(id, store.Value);
        Assert.Equal(id, new ThemeSelection(store).Current.Id);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unknown-theme")]
    public void MissingOrUnknownSavedThemeFallsBackToDefault(string? stored)
    {
        Assert.Equal("frosted", new ThemeSelection(new MemoryStore { Value = stored }).Current.Id);
    }

    [Fact]
    public void UnknownSelectionDoesNotOverwriteSavedThemeOrRaiseChange()
    {
        var store = new MemoryStore { Value = "vinyl" };
        var state = new ThemeSelection(store);
        var changes = 0;
        state.Changed += (_, _) => changes++;
        Assert.False(state.Select("not-a-theme"));
        Assert.Equal("vinyl", state.Current.Id);
        Assert.Equal("vinyl", store.Value);
        Assert.Equal(0, changes);
    }

    [Fact]
    public void FailedWriteChangesThePreviewButReportsThatItWasNotSaved()
    {
        var store = new MemoryStore { Value = "frosted", FailWrite = true };
        var state = new ThemeSelection(store);
        Assert.True(state.Select("aurora"));
        Assert.Equal("aurora", state.Current.Id);
        Assert.False(state.LastWriteSucceeded);
        Assert.Equal("frosted", new ThemeSelection(store).Current.Id);
    }

    [Fact]
    public void StorageExceptionsDoNotCrashTheAppAndCanBeRetried()
    {
        var store = new MemoryStore { ThrowOnRead = true, ThrowOnWrite = true };
        var state = new ThemeSelection(store);
        Assert.Equal("frosted", state.Current.Id);
        state.Select("vinyl");
        Assert.False(state.LastWriteSucceeded);
        store.ThrowOnRead = false;
        store.ThrowOnWrite = false;
        state.Select("vinyl");
        Assert.True(state.LastWriteSucceeded);
        Assert.Equal("vinyl", new ThemeSelection(store).Current.Id);
    }

    [Fact]
    public void FileStorePersistsAndReplacesValuesAcrossInstances()
    {
        var root = Path.Combine(Path.GetTempPath(), $"themashup-tests-{Guid.NewGuid():N}");
        try
        {
            var path = Path.Combine(root, "nested", "appearance.txt");
            var store = new FileThemeStore(path);
            Assert.Null(store.Read());
            Assert.True(store.TryWrite("paper-ink"));
            Assert.Equal("paper-ink", new FileThemeStore(path).Read());
            Assert.True(store.TryWrite("aurora"));
            Assert.Equal("aurora", new FileThemeStore(path).Read());
            Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(path)!, ".appearance-*.tmp"));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public void FileStoreCleansTemporaryFileWhenReplacementFails()
    {
        var root = Path.Combine(Path.GetTempPath(), $"themashup-tests-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(root);
            var occupiedByDirectory = Path.Combine(root, "appearance.txt");
            Directory.CreateDirectory(occupiedByDirectory);
            Assert.False(new FileThemeStore(occupiedByDirectory).TryWrite("neon"));
            Assert.True(Directory.Exists(occupiedByDirectory));
            Assert.Empty(Directory.GetFiles(root, ".appearance-*.tmp"));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    private sealed class MemoryStore : IThemeStore
    {
        public string? Value { get; set; }
        public bool FailWrite { get; set; }
        public bool ThrowOnRead { get; set; }
        public bool ThrowOnWrite { get; set; }
        public string? Read() => ThrowOnRead ? throw new IOException("read failed") : Value;
        public bool TryWrite(string id)
        {
            if (ThrowOnWrite) throw new IOException("write failed");
            if (FailWrite) return false;
            Value = id;
            return true;
        }
    }
}
