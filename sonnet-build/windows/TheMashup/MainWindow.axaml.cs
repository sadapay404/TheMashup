using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using TheMashup.ViewModels;

namespace TheMashup;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        // Commit seeks only on pointer release so the position timer doesn't fight the user's drag.
        foreach (var name in new[] { "SeekSlider", "SeekSliderBig" })
        {
            var slider = this.FindControl<Slider>(name);
            if (slider is null) continue;
            slider.AddHandler(PointerPressedEvent, (_, _) => { if (DataContext is MainViewModel vm) vm.Seeking = true; }, RoutingStrategies.Tunnel, true);
            slider.AddHandler(PointerReleasedEvent, (_, _) => { if (DataContext is MainViewModel vm) vm.CommitSeek(slider.Value); }, RoutingStrategies.Tunnel | RoutingStrategies.Bubble, true);
        }

        DataContextChanged += (_, _) =>
        {
            if (DataContext is MainViewModel vm) vm.LyricIndexChanged += ScrollLyrics;
        };
    }

    private void ScrollLyrics(int index)
    {
        Dispatcher.UIThread.Post(() =>
        {
            try
            {
                var scroll = this.FindControl<ScrollViewer>("LyricsScroll");
                var list = this.FindControl<ItemsControl>("LyricsList");
                if (scroll is null || list is null || index < 0) return;
                var container = list.ContainerFromIndex(index);
                if (container is null) return;
                var pt = container.TranslatePoint(new Point(0, 0), list);
                if (pt is null) return;
                var listTop = list.TranslatePoint(new Point(0, 0), scroll.Content as Visual ?? scroll)?.Y ?? 0;
                var target = listTop + pt.Value.Y - scroll.Viewport.Height / 2 + container.Bounds.Height / 2;
                scroll.Offset = new Vector(0, Math.Max(0, target));
            }
            catch { /* cosmetic only */ }
        });
    }
}
