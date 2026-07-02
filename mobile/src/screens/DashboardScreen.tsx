import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  AsyncStorage,
} from 'react-native';
import axios from 'axios';

const DashboardScreen = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const savedToken = await AsyncStorage.getItem('token');
      setToken(savedToken || '');
      await fetchStats(savedToken || '');
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (authToken: string) => {
    try {
      const response = await axios.get('http://localhost:5000/api/analytics/stats/1', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setStats(response.data.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchStats(token);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#5a67d8" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Today's Summary</Text>
      </View>

      {stats && (
        <>
          <View style={styles.metricsGrid}>
            <MetricCard
              label="Total P&L"
              value={`₹${stats.total_pnl}`}
              color={parseFloat(stats.total_pnl) > 0 ? '#22c55e' : '#ef4444'}
            />
            <MetricCard
              label="Win Rate"
              value={stats.win_rate}
              color="#5a67d8"
            />
            <MetricCard
              label="Trades"
              value={stats.total_trades}
              color="#64748b"
            />
            <MetricCard
              label="Profit Factor"
              value={stats.profit_factor}
              color="#f59e0b"
            />
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.sectionTitle}>Performance</Text>
            <DetailRow label="Wins" value={`${stats.wins}/${stats.total_trades}`} />
            <DetailRow label="Losses" value={stats.losses} />
            <DetailRow label="Avg Win" value={`₹${stats.avg_win}`} color="#22c55e" />
            <DetailRow label="Avg Loss" value={`₹${stats.avg_loss}`} color="#ef4444" />
            <DetailRow label="Best Trade" value={`₹${stats.best_trade}`} />
            <DetailRow label="Worst Trade" value={`₹${stats.worst_trade}`} />
          </View>
        </>
      )}
    </ScrollView>
  );
};

const MetricCard = ({ label, value, color }: any) => (
  <View style={styles.metricCard}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={[styles.metricValue, { color }]}>{value}</Text>
  </View>
);

const DetailRow = ({ label, value, color }: any) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={[styles.detailValue, color && { color }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 20,
    paddingTop: 30,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  metricsGrid: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  detailSection: {
    backgroundColor: 'white',
    margin: 10,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    color: '#333',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: {
    color: '#666',
    fontSize: 14,
  },
  detailValue: {
    color: '#333',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default DashboardScreen;
