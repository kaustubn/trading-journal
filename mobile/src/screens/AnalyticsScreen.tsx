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

const AnalyticsScreen = () => {
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
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
      await fetchAnalytics(savedToken || '');
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async (authToken: string) => {
    try {
      const response = await axios.get('http://localhost:5000/api/analytics/monthly/1', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setMonthlyData(response.data.data || []);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAnalytics(token);
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
        <Text style={styles.title}>Monthly Performance</Text>
      </View>

      {monthlyData.map((month, index) => (
        <View key={index} style={styles.monthCard}>
          <View style={styles.monthHeader}>
            <Text style={styles.monthLabel}>{month.month}</Text>
            <Text style={[styles.monthPnL, { color: month.pnl >= 0 ? '#22c55e' : '#ef4444' }]}>
              ₹{month.pnl}
            </Text>
          </View>
          <View style={styles.monthDetails}>
            <StatItem label="Trades" value={month.trades} />
            <StatItem label="Win Rate" value={month.win_rate} />
            <StatItem label="Wins" value={month.wins} />
            <StatItem label="Losses" value={month.losses} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

const StatItem = ({ label, value }: any) => (
  <View style={styles.statItem}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  monthCard: {
    backgroundColor: 'white',
    marginHorizontal: 10,
    marginVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  monthPnL: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  monthDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
  },
  statItem: {
    width: '50%',
    padding: 10,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
});

export default AnalyticsScreen;
