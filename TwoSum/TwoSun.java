import java.util.HashMap;

public class TwoSun {
    public int[] twoSum(int[] nums, int target) {
        var list = new HashMap<Integer, Integer>();

        for(int i = 0; i < nums.length; i++) {
            if (list.containsKey(target - nums[i]))
                return new int[]{list.get(target - nums[i]), i};

            list.put(nums[i], i);
        }
        return null;
    }
}
