using TheMashup.Core;
using TheMashup.UI;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class ShellViewModelTests
{
    [Fact]
    public void NavigationChangesOnlyToKnownPagesAndNotifiesBindings()
    {
        var model = NewModel(new Store());
        var changed = new List<string?>();
        model.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        Assert.True(model.IsHome);
        model.NavigateCommand.Execute("search");
        Assert.True(model.IsSearch);
        Assert.True(model.IsFeaturePage);
        Assert.False(model.IsHome);
        Assert.Equal("Search", model.PageTitle);
        Assert.Contains(nameof(model.PageTitle), changed);
        model.NavigateCommand.Execute("settings");
        Assert.True(model.IsSettings);
        Assert.False(model.IsFeaturePage);
        model.NavigateCommand.Execute("unknown");
        Assert.True(model.IsSettings);
    }

    [Fact]
    public void CompactWidthHidesRailAndSidebarLabelsAndCanExpandAgain()
    {
        var model = NewModel(new Store());
        model.UpdateWidth(1440);
        Assert.True(model.ShowNavLabels);
        Assert.True(model.ShowHeroArtwork);
        Assert.Equal(224, model.SidebarWidth.Value);
        model.UpdateWidth(1000);
        Assert.True(model.ShowNavLabels);
        Assert.False(model.ShowHeroArtwork);
        model.UpdateWidth(760);
        Assert.False(model.ShowNavLabels);
        Assert.False(model.ShowHeroArtwork);
        Assert.Equal(76, model.SidebarWidth.Value);
        model.UpdateWidth(1440);
        Assert.True(model.ShowNavLabels);
        Assert.True(model.ShowHeroArtwork);
    }

    [Fact]
    public void ThemeCommandUpdatesSelectionAndSurfacesWriteFailures()
    {
        var store = new Store { Fail = true };
        var model = NewModel(store);
        model.SelectThemeCommand.Execute("aurora");
        Assert.True(model.IsAurora);
        Assert.Contains("Couldn’t save", model.ThemeStatus);
        store.Fail = false;
        model.SelectThemeCommand.Execute("vinyl");
        Assert.True(model.IsVinyl);
        Assert.Equal("vinyl", store.Value);
        Assert.Contains("stored on this device", model.ThemeStatus);
    }


    [Fact]
    public void PlaylistCommandsCreateRenameConfirmDeleteAndPersist()
    {
        var store = new LibraryStore();
        var model = new ShellViewModel(new ThemeSelection(new Store()), new Library(store));
        model.NavigateCommand.Execute("library");
        Assert.True(model.IsLibrary);
        Assert.True(model.HasNoPlaylists);
        model.NewPlaylistName = "  My music  ";
        model.CreatePlaylistCommand.Execute(null);
        Assert.Equal("1 playlist", model.PlaylistCountText);
        var row = Assert.Single(model.PlaylistRows);
        Assert.Equal("My music", row.Name);
        row.BeginRenameCommand.Execute(null);
        Assert.True(row.IsEditing);
        row.DraftName = "Evening";
        row.SaveNameCommand.Execute(null);
        row = Assert.Single(model.PlaylistRows);
        Assert.Equal("Evening", row.Name);
        Assert.Equal("Evening", Assert.Single(new Library(store).Playlists).Name);
        row.BeginDeleteCommand.Execute(null);
        Assert.True(row.IsConfirmingDelete);
        Assert.Single(model.PlaylistRows); // opening confirmation must not delete
        row.CancelDeleteCommand.Execute(null);
        Assert.Single(model.PlaylistRows);
        row.BeginDeleteCommand.Execute(null);
        row.ConfirmDeleteCommand.Execute(null);
        Assert.Empty(model.PlaylistRows);
        Assert.Empty(new Library(store).Playlists);
    }

    [Fact]
    public void InvalidPlaylistNameAndStorageFailuresAreVisible()
    {
        var store = new LibraryStore { FailWrite = true };
        var model = new ShellViewModel(new ThemeSelection(new Store()), new Library(store));
        model.CreatePlaylistCommand.Execute(null);
        Assert.True(model.HasPlaylistMessage);
        model.NewPlaylistName = "Valid";
        model.CreatePlaylistCommand.Execute(null);
        Assert.Single(model.PlaylistRows);
        Assert.Contains("Couldn’t save", model.LibraryStatus);
    }

    [Fact]
    public void DamagedLibraryDisablesEditingAndReportsPreservation()
    {
        var model = new ShellViewModel(new ThemeSelection(new Store()), new Library(new LibraryStore { Value = "bad data" }));
        Assert.False(model.CanEditLibrary);
        Assert.Contains("preserved", model.LibraryStatus);
        model.NewPlaylistName = "Do not save";
        model.CreatePlaylistCommand.Execute(null);
        Assert.Empty(model.PlaylistRows);
    }

    private static ShellViewModel NewModel(Store store) =>
        new(new ThemeSelection(store), new Library(new LibraryStore()));

    private sealed class LibraryStore : ILibraryStore
    {
        public string? Value { get; set; }
        public bool FailWrite { get; set; }
        public LibraryReadResult Read() => new(true, Value);
        public bool TryWrite(string value) { if (FailWrite) return false; Value = value; return true; }
    }

    private sealed class Store : IThemeStore
    {
        public string? Value { get; private set; }
        public bool Fail { get; set; }
        public string? Read() => Value;
        public bool TryWrite(string id)
        {
            if (Fail) return false;
            Value = id;
            return true;
        }
    }
}
