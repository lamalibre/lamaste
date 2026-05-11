import { useParams } from 'react-router-dom';
import { PluginLoader } from '../admin/index.js';

/**
 * Bridges React Router params to the shared PluginLoader component.
 */
export default function PluginLoaderRoute() {
  const { pluginName, '*': subPath } = useParams();
  return (
    <PluginLoader
      pluginName={pluginName}
      subPath={subPath || ''}
      basePath={`/plugins/${pluginName}`}
      panelUrl={window.location.origin}
    />
  );
}
