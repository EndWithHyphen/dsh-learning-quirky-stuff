import React from 'react';
import { useLearning } from './context.jsx';
import { featureById } from '../../shared/features.js';
import TopicsView from './topics-view.jsx';
import ExploreView from './explore-view.jsx';
import SearchView from './search-view.jsx';
import PreviewView from './preview-view.jsx';
import FeedbackView from './feedback-view.jsx';
import WeeklyView from './weekly-view.jsx';
const views = {
  weekly: WeeklyView,
  topics: TopicsView,
  explore: ExploreView,
  search: SearchView,
  preview: PreviewView,
  feedback: FeedbackView,
};
class FeatureBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="sb-empty">
        <h2>这个学习工具暂时未能打开</h2>
        <p>{this.state.error.message}</p>
        <button className="sb-button" onClick={() => this.setState({ error: null })}>
          重试
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function ModulePage({ feature, context }) {
  const learning = useLearning(),
    View = views[feature];
  if (!View) return null;
  if (!learning.enabled(feature))
    return (
      <div className="sb-empty">
        <h2>{featureById(feature).title}已关闭</h2>
        <p>可以在功能设置中重新开启，已保存的数据会保留。</p>
      </div>
    );
  return (
    <FeatureBoundary key={feature}>
      <View context={context} />
    </FeatureBoundary>
  );
}
