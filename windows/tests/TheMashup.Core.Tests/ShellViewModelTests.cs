using TheMashup.Core;
using TheMashup.UI;
using Xunit;

namespace TheMashup.Core.Tests;

public sealed class ShellViewModelTests
{
    [Fact]
    public void NavigationChangesOnlyToKnownPagesAndNotifiesBindings()
    {
        var model = new ShellViewModel(new ThemeSelection(new Store()));
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
        var model = new ShellViewModel(new ThemeSelection(new Store()));
        model.UpdateWidth(1440);
        Assert.True(model.ShowNavLabels);
        Assert.True(model.ShowRightRail);
        Assert.Equal(224, model.SidebarWidth.Value);
        model.UpdateWidth(1000);
        Assert.True(model.ShowNavLabels);
        Assert.False(model.ShowRightRail);
        model.UpdateWidth(760);
        Assert.False(model.ShowNavLabels);
        Assert.False(model.ShowRightRail);
        Assert.Equal(76, model.SidebarWidth.Value);
        model.UpdateWidth(1440);
        Assert.True(model.ShowNavLabels);
        Assert.True(model.ShowRightRail);
    }

    [Fact]
    public void ThemeCommandUpdatesSelectionAndSurfacesWriteFailures()
    {
        var store = new Store { Fail = true };
        var model = new ShellViewModel(new ThemeSelection(store));
        model.SelectThemeCommand.Execute("aurora");
        Assert.True(model.IsAurora);
        Assert.Contains("Couldn’t save", model.ThemeStatus);
        store.Fail = false;
        model.SelectThemeCommand.Execute("vinyl");
        Assert.True(model.IsVinyl);
        Assert.Equal("vinyl", store.Value);
        Assert.Contains("stored on this device", model.ThemeStatus);
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
