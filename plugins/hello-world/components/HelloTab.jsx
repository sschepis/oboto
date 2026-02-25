function HelloTab() {
  return (
    <Card>
      <Text variant="heading">Hello from Plugin! 🔌</Text>
      <Text>
        This tab was rendered by the <strong>hello-world</strong> plugin.
        Plugin UI components use the same Surface Kit primitives as Surfaces.
      </Text>
      <Stack direction="horizontal" gap="sm">
        <Badge variant="success">Active</Badge>
        <Badge variant="info">Plugin v1.0.0</Badge>
      </Stack>
    </Card>
  );
}
