using Avalonia.Controls;

namespace TheMashup.UI.Views;

public partial class MainView : UserControl
{
    public MainView()
    {
        InitializeComponent();
        SizeChanged += (_, args) => (DataContext as ShellViewModel)?.UpdateWidth(args.NewSize.Width);
        DataContextChanged += (_, _) => (DataContext as ShellViewModel)?.UpdateWidth(Bounds.Width);
    }
}
